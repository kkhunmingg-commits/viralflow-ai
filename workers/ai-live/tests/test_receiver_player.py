"""Bounds and reconnect checks for the DEV live receiver, not presenter mocks."""
import http.client
import json
import socket
import sys
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from receiver_player import ReceiverPlayer, _PlayerHTTPServer


def box(kind, value):
    return (len(value) + 8).to_bytes(4, "big") + kind + value


def wait_until(predicate, timeout=1):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(.01)
    return False


class ReceiverPlayerTests(unittest.TestCase):
    def start_player(self):
        with socket.socket() as temporary:
            temporary.bind(("127.0.0.1", 0))
            port = temporary.getsockname()[1]
        player = ReceiverPlayer(port)
        self.addCleanup(player.stop)
        player.start()
        return player

    def partial_post(self, player):
        client = socket.create_connection(("127.0.0.1", player.port), timeout=2)
        self.addCleanup(client.close)
        request = (f"POST /observations HTTP/1.1\r\nHost: 127.0.0.1:{player.port}\r\n"
                   "Content-Type: application/json\r\nContent-Length: 4096\r\n\r\n")
        client.sendall(request.encode())
        return client

    @staticmethod
    def client_count(player):
        with player._server._clients_lock:
            return len(player._server._clients)

    def test_fragments_require_received_init_and_survive_arbitrary_byte_splits(self):
        player = ReceiverPlayer(18866)
        epoch = player.new_connection()
        data = box(b"ftyp", b"iso5") + box(b"moov", box(b"avcC", b"\x01\x42\xc0\x0d") + b"mp4a")
        data += box(b"moof", b"first") + box(b"mdat", b"received-audio-video")
        for byte in data:
            player.accept(epoch, bytes([byte]))
        self.assertTrue(player.status()["ready"])
        self.assertIn("avc1.42c00d", player.status()["mime"])
        self.assertEqual(player.evidence()["fragments_received"], 1)
        next_epoch = player.new_connection()
        player.accept(epoch, data)
        self.assertFalse(player.status()["ready"])
        player.accept(next_epoch, data)
        self.assertTrue(player.status()["ready"])

    def test_cache_is_bounded_and_invalid_unbounded_boxes_are_rejected(self):
        player = ReceiverPlayer(18866)
        epoch = player.new_connection()
        for _ in range(100):
            player.accept(epoch, box(b"moof", b"m") + box(b"mdat", b"x" * 180000))
        self.assertLessEqual(player.evidence()["max_cache_bytes"], player.MAX_CACHE_BYTES)
        self.assertLessEqual(len(player._fragments), 32)
        with self.assertRaisesRegex(ValueError, "PLAYER_BOX_INVALID"):
            player.accept(epoch, (player.MAX_BOX_BYTES + 1).to_bytes(4, "big") + b"mdat")

    def test_stale_tab_observations_are_rejected_before_connection_and_after_reconnect(self):
        player = ReceiverPlayer(18866)
        observation = {"generation": 2, "currentTime": 100, "decodedVideoFrames": 2500,
                       "audioDecodedBytes": 3200000, "readyState": 4, "playing": True,
                       "soundEnabled": True, "audioRms": .05, "errors": 0}
        with self.assertRaisesRegex(ValueError, "PLAYER_OBSERVATION_STALE"):
            player.record(observation)  # A previous proof's tab while this receiver is still generation 0.
        first = player.new_connection()
        with self.assertRaisesRegex(ValueError, "PLAYER_OBSERVATION_STALE"):
            player.record(observation)
        self.assertFalse(player.evidence()["observations"])
        current = {**observation, "generation": first}
        player.record(current)
        second = player.new_connection()
        with self.assertRaisesRegex(ValueError, "PLAYER_OBSERVATION_STALE"):
            player.record(current)
        latest = {**observation, "generation": second}
        player.record(latest)
        self.assertEqual(player.evidence()["observations"], [current, latest])

    def test_loopback_endpoint_rejects_foreign_origin_and_drops_extra_diagnostics(self):
        with socket.socket() as temporary:
            temporary.bind(("127.0.0.1", 0))
            port = temporary.getsockname()[1]
        player = ReceiverPlayer(port)
        player.start()
        transport = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            request = urllib.request.Request(f"http://127.0.0.1:{port}/status", headers={"Origin": "https://foreign.example"})
            with self.assertRaises(urllib.error.HTTPError) as failure:
                transport.open(request, timeout=2)
            self.assertEqual(failure.exception.code, 403)
            request = urllib.request.Request(f"http://127.0.0.1:{port}/observations", data=json.dumps({"stream_key": "never-accepted"}).encode(),
                headers={"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as failure:
                transport.open(request, timeout=2)
            self.assertEqual(failure.exception.code, 400)
            self.assertFalse(player.evidence()["observations"])
        finally:
            player.stop()

    def test_partial_post_reads_have_a_socket_timeout_and_release_the_handler(self):
        with patch.object(_PlayerHTTPServer, "CLIENT_TIMEOUT_SECONDS", .15):
            player = self.start_player()
            client = self.partial_post(player)
            self.assertTrue(wait_until(lambda: self.client_count(player) == 1))
            with player._server._clients_lock:
                server_socket = next(iter(player._server._clients))
                self.assertEqual(server_socket.gettimeout(), .15)
            self.assertIn(b"408", client.recv(4096))
            self.assertTrue(wait_until(lambda: self.client_count(player) == 0))
            self.assertFalse(player.evidence()["observations"])

    def test_stop_closes_partial_post_sockets_and_joins_their_handlers(self):
        player = self.start_player()
        clients = [self.partial_post(player) for _ in range(4)]
        self.assertTrue(wait_until(lambda: self.client_count(player) == 4))
        with player._server._clients_lock:
            handlers = list(player._server._clients.values())
        player.stop()
        self.assertEqual(self.client_count(player), 0)
        self.assertTrue(all(not thread.is_alive() for thread in handlers))
        self.assertFalse(player._thread.is_alive())
        for client in clients:
            self.assertEqual(client.recv(4096), b"")
        player.stop()  # Stop remains idempotent after all clients are gone.

    def test_accepted_client_limit_fails_fast_and_releases_slots_after_disconnect(self):
        with patch.object(_PlayerHTTPServer, "MAX_CLIENTS", 2):
            player = self.start_player()
            clients = [self.partial_post(player) for _ in range(2)]
            self.assertTrue(wait_until(lambda: self.client_count(player) == 2))
            transport = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            started = time.monotonic()
            try:
                with transport.open(f"http://127.0.0.1:{player.port}/status", timeout=1):
                    self.fail("An overflow client must be rejected")
            except urllib.error.HTTPError as failure:
                self.assertEqual(failure.code, 503)
                failure.close()
            except (ConnectionResetError, ConnectionAbortedError, http.client.RemoteDisconnected):
                pass  # Windows may reset a rejected socket with an unread request.
            except urllib.error.URLError as failure:
                self.assertIsInstance(failure.reason, (ConnectionResetError, ConnectionAbortedError,
                                                      http.client.RemoteDisconnected))
            self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(self.client_count(player), 2)
            for client in clients:
                client.close()
            self.assertTrue(wait_until(lambda: self.client_count(player) == 0))
            with transport.open(f"http://127.0.0.1:{player.port}/status", timeout=1) as response:
                self.assertEqual(response.status, 200)

    def test_fragment_response_wait_does_not_hold_the_media_parser_lock(self):
        player = self.start_player()
        generation = player.new_connection()
        fragment = box(b"moof", b"first") + box(b"mdat", b"received-audio-video")
        player.accept(generation, fragment)
        entered, release, advanced = threading.Event(), threading.Event(), threading.Event()
        reply = player._server.RequestHandlerClass._reply
        body = []

        def delayed_reply(handler, *args):
            entered.set()
            release.wait(1)
            return reply(handler, *args)

        def fetch_fragment():
            transport = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with transport.open(f"http://127.0.0.1:{player.port}/fragment?generation={generation}&sequence=1", timeout=2) as response:
                body.append(response.read())

        def advance_media():
            player.accept(generation, box(b"moof", b"next") + box(b"mdat", b"more-audio-video"))
            advanced.set()

        with patch.object(player._server.RequestHandlerClass, "_reply", delayed_reply):
            request = threading.Thread(target=fetch_fragment, daemon=True)
            request.start()
            self.assertTrue(entered.wait(1))
            producer = threading.Thread(target=advance_media, daemon=True)
            producer.start()
            try:
                self.assertTrue(advanced.wait(.5), "Response writes must not block incoming media")
            finally:
                release.set()
                producer.join(timeout=1)
                request.join(timeout=1)
        self.assertEqual(body, [fragment])

    def test_normal_init_fragments_and_observations_keep_the_same_http_contract(self):
        player = self.start_player()
        generation = player.new_connection()
        init = box(b"ftyp", b"iso5") + box(b"moov", box(b"avcC", b"\x01\x42\xc0\x0d") + b"mp4a")
        fragment = box(b"moof", b"first") + box(b"mdat", b"received-audio-video")
        player.accept(generation, init + fragment)
        transport = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for endpoint, expected in (("init", init), ("fragment", fragment)):
            with transport.open(f"http://127.0.0.1:{player.port}/{endpoint}?generation={generation}&sequence=1", timeout=1) as response:
                self.assertEqual(response.headers["Content-Type"], "video/mp4")
                self.assertEqual(response.read(), expected)
        observation = {"generation": generation, "currentTime": 1, "decodedVideoFrames": 25,
                       "audioDecodedBytes": 32000, "readyState": 4, "playing": True,
                       "soundEnabled": True, "audioRms": .05, "errors": 0}
        request = urllib.request.Request(f"http://127.0.0.1:{player.port}/observations",
            data=json.dumps(observation).encode(), headers={"Content-Type": "application/json"})
        with transport.open(request, timeout=1) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(player.evidence()["observations"], [observation])


if __name__ == "__main__":
    unittest.main()
