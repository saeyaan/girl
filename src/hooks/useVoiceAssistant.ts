import { useState, useEffect, useRef, useCallback } from 'react';
import { AssistantState, AssistantSettings } from '../types.ts';
import { cleanTextForSpeech, getEmotionSpeechParameters, AssistantEmotion } from '../utils/conversationUtils.ts';

// Type definitions for Web Speech API
interface SpeechRecognitionEventLike extends Event {
  results: {
    length: number;
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
      isFinal: boolean;
    };
  };
}

export function useVoiceAssistant(
  settings: AssistantSettings,
  onFinalTranscript: (transcript: string) => void
) {
  const [state, setState] = useState<AssistantState>('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0); // 0 to 1 for visualizer
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const isSpeakingRef = useRef(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Initialize SpeechRecognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('Web Speech API not natively supported in this browser, using audio recorder fallback');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      // Set recognition language based on settings
      if (settings.language === 'hi') {
        recognition.lang = 'hi-IN';
      } else if (settings.language === 'bn') {
        recognition.lang = 'bn-IN';
      } else {
        recognition.lang = 'en-US';
      }

      recognition.onstart = () => {
        setState((curr) => (curr === 'speaking' ? curr : 'listening'));
        setErrorMessage(null);
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let interim = '';
        let final = '';

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            final += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }

        if (interim) {
          setInterimTranscript(interim);
        }

        if (final.trim()) {
          setInterimTranscript('');
          onFinalTranscript(final.trim());
          if (!settings.continuousListening) {
            stopListening();
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('SpeechRecognition error:', event.error);
        if (event.error === 'not-allowed') {
          setErrorMessage('Microphone access was denied. Please allow microphone permissions.');
          setState('error');
        } else if (event.error !== 'no-speech') {
          setErrorMessage(`Audio issue: ${event.error}`);
        }
      };

      recognition.onend = () => {
        // If continuous listening is enabled and we are not speaking or thinking, restart
        if (settings.continuousListening && !isSpeakingRef.current && state === 'listening') {
          try {
            recognition.start();
          } catch {
            // Already active or error
          }
        } else if (state === 'listening') {
          setState('idle');
        }
      };

      recognitionRef.current = recognition;
    } catch (err) {
      console.error('Failed to init speech recognition:', err);
    }

    return () => {
      try {
        if (recognitionRef.current) recognitionRef.current.abort();
      } catch {}
    };
  }, [settings.language, settings.continuousListening, onFinalTranscript]);

  // Audio Context and Frequency Meter
  const setupAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Monitor microphone volume for sound wave animation
  const startMicMonitoring = useCallback(async () => {
    try {
      const ctx = await setupAudioContext();
      if (!micStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;
      }

      const analyser = analyserRef.current;
      if (!analyser) return;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(1, avg / 128));
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch (err) {
      console.warn('Microphone monitoring error:', err);
    }
  }, [setupAudioContext]);

  const stopMicMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  // Interrupt any ongoing speech
  const interrupt = useCallback(() => {
    if (audioSourceRef.current) {
      if ('stop' in audioSourceRef.current && typeof audioSourceRef.current.stop === 'function') {
        try {
          audioSourceRef.current.stop();
        } catch {}
      } else if ('pause' in audioSourceRef.current) {
        audioSourceRef.current.pause();
      }
      audioSourceRef.current = null;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    isSpeakingRef.current = false;
    currentUtteranceRef.current = null;
    if (state === 'speaking') {
      setState('idle');
    }
  }, [state]);

  // Start listening
  const startListening = useCallback(async () => {
    interrupt();
    setErrorMessage(null);
    setInterimTranscript('');

    try {
      await startMicMonitoring();
      if (recognitionRef.current) {
        recognitionRef.current.start();
        setState('listening');
      } else {
        // Fallback: start MediaRecorder for Gemini Transcribe
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        recordedChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64Audio = (reader.result as string).split(',')[1];
            setState('thinking');
            try {
              const res = await fetch('/api/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioBase64: base64Audio, mimeType: 'audio/webm' }),
              });
              const data = await res.json();
              if (data.text) {
                onFinalTranscript(data.text);
              } else {
                setState('idle');
              }
            } catch (err: any) {
              setErrorMessage('Failed to transcribe audio.');
              setState('error');
            }
          };
          reader.readAsDataURL(blob);
        };

        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;
        setState('listening');
      }
    } catch (err: any) {
      console.error('Failed to start listening:', err);
      setErrorMessage(err.message || 'Could not access microphone');
      setState('error');
    }
  }, [interrupt, startMicMonitoring, onFinalTranscript]);

  // Stop listening
  const stopListening = useCallback(() => {
    stopMicMonitoring();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (state === 'listening') {
      setState('idle');
    }
  }, [stopMicMonitoring, state]);

  // Speak text with Gemini TTS or Browser SpeechSynthesis
  const speakText = useCallback(
    async (text: string, emotion: AssistantEmotion = 'friendly', onDone?: () => void) => {
      interrupt();
      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) return;

      setState('speaking');
      isSpeakingRef.current = true;

      const emotionParams = getEmotionSpeechParameters(emotion);

      // Strategy 1: Attempt Gemini 3.8 Flash Lite TTS first if enabled
      if (settings.voiceProvider === 'gemini') {
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: cleaned,
              voiceName: settings.femaleVoice || 'Kore',
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.audioBase64) {
              const ctx = await setupAudioContext();
              const binary = atob(data.audioBase64);
              const len = binary.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
              }

              const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;

              // Connect to an analyser for real-time speech waveform
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 64;
              source.connect(analyser);
              analyser.connect(ctx.destination);

              // Monitor audio level
              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              const updateSpeechLevel = () => {
                if (!isSpeakingRef.current) return;
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                setAudioLevel(Math.min(1, (sum / dataArray.length) / 100));
                animationFrameRef.current = requestAnimationFrame(updateSpeechLevel);
              };
              updateSpeechLevel();

              source.onended = () => {
                isSpeakingRef.current = false;
                setAudioLevel(0);
                if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
                setState('idle');
                if (onDone) onDone();
                if (settings.continuousListening) {
                  setTimeout(() => startListening(), 300);
                }
              };

              audioSourceRef.current = source;
              source.start(0);
              return;
            }
          }
        } catch (err) {
          console.warn('Gemini TTS playback failed, falling back to Browser SpeechSynthesis:', err);
        }
      }

      // Strategy 2: Browser SpeechSynthesis fallback
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleaned);

        // Pick preferred female voice
        const voices = window.speechSynthesis.getVoices();
        const femaleVoice =
          voices.find(
            (v) =>
              (settings.language === 'hi' && v.lang.startsWith('hi')) ||
              (settings.language === 'bn' && v.lang.startsWith('bn')) ||
              (/female|woman|samantha|zira|karen|victoria|moira|lekha|priya/i.test(v.name) &&
                v.lang.startsWith(settings.language))
          ) ||
          voices.find((v) => /female|samantha|zira|karen/i.test(v.name)) ||
          voices[0];

        if (femaleVoice) {
          utterance.voice = femaleVoice;
        }

        utterance.rate = (settings.speakingRate || 1.0) * emotionParams.rate;
        utterance.pitch = (settings.pitch || 1.1) * emotionParams.pitch;
        utterance.volume = settings.volume || 1.0;

        // Simulate waveform level changes during browser speech
        const speechPulseInterval = setInterval(() => {
          if (!isSpeakingRef.current) {
            clearInterval(speechPulseInterval);
            return;
          }
          setAudioLevel(0.3 + Math.random() * 0.5);
        }, 80);

        utterance.onend = () => {
          clearInterval(speechPulseInterval);
          isSpeakingRef.current = false;
          setAudioLevel(0);
          setState('idle');
          if (onDone) onDone();
          if (settings.continuousListening) {
            setTimeout(() => startListening(), 300);
          }
        };

        utterance.onerror = (e) => {
          clearInterval(speechPulseInterval);
          isSpeakingRef.current = false;
          setAudioLevel(0);
          console.warn('SpeechSynthesis error:', e);
          setState('idle');
        };

        currentUtteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      } else {
        setState('idle');
        isSpeakingRef.current = false;
      }
    },
    [interrupt, settings, setupAudioContext, startListening]
  );

  return {
    state,
    setState,
    interimTranscript,
    audioLevel,
    errorMessage,
    setErrorMessage,
    startListening,
    stopListening,
    speakText,
    interrupt,
  };
}
