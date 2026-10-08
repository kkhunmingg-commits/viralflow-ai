"""No paid TTS; test authorization and the actual offline speech contract."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from offline_voice import WindowsOfflineVoice, dev_enabled


class OfflineVoiceTests(unittest.TestCase):
    def test_explicit_dev_gate(self):
        base = {'AI_LIVE_DEV_FALLBACK': 'true', 'PRESENTER_PROVIDER': 'dev_fallback'}
        self.assertTrue(dev_enabled(base))
        self.assertFalse(dev_enabled({}))
        for setting in ({'APP_ENV': 'production'}, {'NODE_ENV': 'production'}, {'VERCEL_ENV': 'production'}, {'AI_LIVE_ENV': 'production'}, {'VERCEL': '1'}, {'AI_LIVE_DEV_FALLBACK': 'false'}, {'PRESENTER_PROVIDER': 'musetalk'}):
            self.assertFalse(dev_enabled({**base, **setting}))

    def test_disabled_voice_cannot_initialize(self):
        with patch.dict(os.environ, {}, clear=True), tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'DEV_FALLBACK_DISABLED'):
                WindowsOfflineVoice(Path(directory))

    @unittest.skipUnless(os.name == 'nt', 'Windows voice interface')
    def test_invalid_input_and_cancel_do_not_spawn_speech(self):
        with patch.dict(os.environ, {'AI_LIVE_DEV_FALLBACK': 'true', 'PRESENTER_PROVIDER': 'dev_fallback'}, clear=True), tempfile.TemporaryDirectory() as directory:
            voice = WindowsOfflineVoice(Path(directory), compliance_authorize=lambda text: text)
            for text in ('', ' ' * 5, 'x' * 1001):
                with self.assertRaisesRegex(ValueError, 'INVALID_SPEECH_REQUEST'):
                    list(voice.stream_text(text, 'utterance'))
            voice.cancel()
            self.assertFalse(voice.health()['ready'])
            with self.assertRaisesRegex(RuntimeError, 'DEV_FALLBACK_DISABLED'):
                list(voice.stream_text('hello', 'utterance'))
            self.assertEqual(list(Path(directory).iterdir()), [])

    @unittest.skipUnless(os.name == 'nt' and os.getenv('AI_LIVE_TEST_REAL_VOICE') == 'true', 'Opt-in real Windows speech, requires native speech permission')
    def test_real_thai_speech_and_resource_cleanup(self):
        with patch.dict(os.environ, {'AI_LIVE_DEV_FALLBACK': 'true', 'PRESENTER_PROVIDER': 'dev_fallback', 'APP_ENV': 'development', 'NODE_ENV': 'development'}), tempfile.TemporaryDirectory() as directory:
            voice = WindowsOfflineVoice(Path(directory), compliance_authorize=lambda text: text)
            chunks = list(voice.stream_text('สวัสดีค่ะ กำลังทดสอบเสียงจริง', 'real-thai'))
            self.assertTrue(chunks)
            self.assertTrue(all(0 < len(chunk.pcm16) <= 32000 and len(chunk.pcm16) % 2 == 0 for chunk in chunks))
            self.assertTrue(any(any(chunk.pcm16) for chunk in chunks))
            voice.cancel()
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
