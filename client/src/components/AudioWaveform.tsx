import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';

interface AudioWaveformProps {
  src: string;
  onPlay?: () => void;
  onPause?: () => void;
  className?: string;
}

export default function AudioWaveform({ src, onPlay, onPause, className = '' }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch and analyze audio to generate waveform data
  useEffect(() => {
    const analyzeAudio = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(src);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Get audio data from the first channel
        const rawData = audioBuffer.getChannelData(0);
        const samples = 100; // Number of bars in waveform
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData: number[] = [];

        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          filteredData.push(sum / blockSize);
        }

        // Normalize the data
        const maxVal = Math.max(...filteredData);
        const normalized = filteredData.map(val => val / maxVal);
        setWaveformData(normalized);
        setDuration(audioBuffer.duration);

        audioContext.close();
      } catch (err) {
        console.error('Error analyzing audio:', err);
        // Generate placeholder data on error
        setWaveformData(Array(100).fill(0).map(() => Math.random() * 0.5 + 0.2));
      } finally {
        setIsLoading(false);
      }
    };

    if (src) {
      analyzeAudio();
    }
  }, [src]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barWidth = width / waveformData.length;
    const gap = 1;
    const progress = duration > 0 ? currentTime / duration : 0;
    const progressIndex = Math.floor(progress * waveformData.length);

    ctx.clearRect(0, 0, width, height);

    waveformData.forEach((val, i) => {
      const barHeight = Math.max(val * (height * 0.8), 2);
      const x = i * barWidth;
      const y = (height - barHeight) / 2;

      // Played portion
      if (i < progressIndex) {
        ctx.fillStyle = '#818cf8'; // indigo-400
      } else {
        ctx.fillStyle = '#3f3f46'; // zinc-700
      }

      ctx.beginPath();
      ctx.roundRect(x + gap / 2, y, barWidth - gap, barHeight, 1);
      ctx.fill();
    });
  }, [waveformData, currentTime, duration]);

  // Handle time updates
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      onPause?.();
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [onPause]);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      onPause?.();
    } else {
      audio.play();
      setIsPlaying(true);
      onPlay?.();
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || duration === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    const newTime = progress * duration;

    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        onClick={togglePlayPause}
        disabled={isLoading}
        className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white flex items-center justify-center transition-all duration-200 disabled:opacity-50"
      >
        {isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="w-full h-8 cursor-pointer rounded"
          style={{ width: '100%', height: '32px' }}
        />
        <div className="flex justify-between text-[10px] text-[#71717a] font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <Volume2 className="w-4 h-4 text-[#52525b] flex-shrink-0" />
    </div>
  );
}
