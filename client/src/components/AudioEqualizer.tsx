import React, { useEffect, useRef } from 'react';

interface AudioEqualizerProps {
  analyserNode: AnalyserNode | null;
  isPaused?: boolean;
  barCount?: number;
  className?: string;
}

export default function AudioEqualizer({
  analyserNode,
  isPaused = false,
  barCount = 32,
  className = '',
}: AudioEqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!analyserNode || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!ctx || !canvas) return;

      animationRef.current = requestAnimationFrame(draw);

      // Get frequency data
      analyserNode.getByteFrequencyData(dataArray);

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Calculate bar dimensions
      const barWidth = canvas.width / barCount;
      const gap = 2;
      const effectiveBarWidth = barWidth - gap;

      // Sample the frequency data to match barCount
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        // Average a range of frequencies for smoother visualization
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += dataArray[i * step + j];
        }
        const average = sum / step;

        // Calculate bar height (with minimum height for visual appeal)
        const barHeight = isPaused
          ? 4
          : Math.max(4, (average / 255) * canvas.height);

        // Calculate x position
        const x = i * barWidth + gap / 2;

        // Create gradient for each bar
        const gradient = ctx.createLinearGradient(
          x,
          canvas.height - barHeight,
          x,
          canvas.height
        );

        // Purple to pink gradient matching the app theme
        gradient.addColorStop(0, '#a855f7'); // purple-500
        gradient.addColorStop(0.5, '#ec4899'); // pink-500
        gradient.addColorStop(1, '#6366f1'); // indigo-500

        // Draw rounded bar
        ctx.fillStyle = gradient;
        ctx.beginPath();
        const radius = Math.min(effectiveBarWidth / 2, 3);
        const y = canvas.height - barHeight;

        // Rounded rectangle
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + effectiveBarWidth - radius, y);
        ctx.quadraticCurveTo(x + effectiveBarWidth, y, x + effectiveBarWidth, y + radius);
        ctx.lineTo(x + effectiveBarWidth, canvas.height);
        ctx.lineTo(x, canvas.height);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.fill();
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyserNode, isPaused, barCount]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={60}
      className={`rounded-lg ${className}`}
    />
  );
}
