"""Native Windows containment of only the created worker and descendants."""
import ctypes
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.managed_runtime import WindowsChildJob


@unittest.skipUnless(sys.platform == "win32", "Native Windows process ownership")
class ManagedJobTests(unittest.TestCase):
    def test_closing_owned_job_terminates_worker_and_its_encoder_child(self):
        from ctypes import wintypes
        script = ("import subprocess,sys,time;sys.stdin.readline();"
                  "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],"
                  "creationflags=0x08000000);print(child.pid,flush=True);time.sleep(60)")
        worker = subprocess.Popen([sys.executable, "-I", "-B", "-c", script],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, shell=False, creationflags=0x08000000)
        job = None
        handle = None
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        api.OpenProcess.restype = wintypes.HANDLE
        api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        api.WaitForSingleObject.restype = wintypes.DWORD
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        try:
            job = WindowsChildJob(worker)
            worker.stdin.write("start\n")
            worker.stdin.flush()
            child_pid = int(worker.stdout.readline())
            handle = api.OpenProcess(0x00100000, False, child_pid)
            self.assertTrue(handle)
            job.close()
            worker.wait(timeout=5)
            self.assertEqual(api.WaitForSingleObject(handle, 5000), 0)
            job.close()  # idempotent; no process name scans or unrelated process kills.
        finally:
            if job:
                job.close()
            if worker.poll() is None:
                worker.kill()
                worker.wait(timeout=5)
            if handle:
                api.CloseHandle(handle)
            worker.stdin.close()
            worker.stdout.close()


if __name__ == "__main__":
    unittest.main()
