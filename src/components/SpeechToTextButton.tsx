import { useState, useRef, useCallback } from "react";
import { Mic, MicOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// TypeScript declarations for the Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

interface SpeechToTextButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

const SpeechToTextButton = ({ onTranscript, disabled }: SpeechToTextButtonProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldRestartRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const { toast } = useToast();

  const stopRecording = useCallback(() => {
    shouldRestartRef.current = false;
    setIsRecording(false);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const startRecording = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({
        title: "Speech not supported",
        description: "Your browser doesn't support speech recognition. Try Chrome or Safari.",
        variant: "destructive",
      });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        onTranscriptRef.current(finalTranscript.trim());
      }
    };

    recognition.onerror = (event) => {
      // "no-speech" is normal — user paused talking
      if (event.error === "no-speech") return;
      console.error("Speech recognition error:", event.error);
      stopRecording();
    };

    recognition.onend = () => {
      // Auto-restart to handle natural pauses
      if (shouldRestartRef.current) {
        try {
          recognition.start();
        } catch {
          stopRecording();
        }
      }
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    setIsRecording(true);

    try {
      recognition.start();
    } catch {
      stopRecording();
    }
  }, [stopRecording, toast]);

  const toggle = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const label = isRecording ? "Stop dictation" : "Dictate ingredients";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={toggle}
          disabled={disabled}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors touch-target tap-highlight-none active:scale-95 disabled:opacity-50 ${
            isRecording
              ? "bg-destructive/15 text-destructive"
              : "bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground"
          }`}
          aria-label={label}
        >
          {isRecording ? (
            <MicOff className="w-4 h-4 animate-pulse" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export default SpeechToTextButton;
