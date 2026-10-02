param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Encoding UTF8 -Raw | ConvertFrom-Json
if (-not $request.text -or $request.text.Length -gt 1000 -or -not $request.output) {
    throw 'INVALID_SPEECH_REQUEST'
}
Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $culture = if ($request.text -match '[\u0E00-\u0E7F]') { 'th-TH' } else { 'en-US' }
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq $culture } | Select-Object -First 1
    if (-not $voice) { throw 'LOCAL_VOICE_LANGUAGE_UNAVAILABLE' }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
        16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile([string]$request.output, $format)
    $synth.Speak([string]$request.text)
} finally {
    $synth.Dispose()
}
