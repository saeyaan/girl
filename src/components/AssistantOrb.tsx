import React, { useEffect, useRef } from 'react';
import { AssistantState } from '../types.ts';
import { Mic, Volume2, Sparkles, AlertCircle, Radio } from 'lucide-react';

interface AssistantOrbProps {
  state: AssistantState;
  audioLevel: number; // 0 to 1
  onClick?: () => void;
  size?: number;
}

export const AssistantOrb: React.FC<AssistantOrbProps> = ({
  state,
  audioLevel,
  onClick,
  size = 220,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: Array<{ x: number; y: number; radius: number; angle: number; speed: number; distance: number }> = [];
    const numParticles = 36;
    for (let i = 0; i < numParticles; i++) {
      particles.push({
        x: 0,
        y: 0,
        radius: Math.random() * 2 + 1,
        angle: (i / numParticles) * Math.PI * 2,
        speed: 0.02 + Math.random() * 0.03,
        distance: 55 + Math.random() * 40,
      });
    }

    const render = () => {
      phaseRef.current += 0.04;
      const phase = phaseRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      // 1. STATE-SPECIFIC PALETTE & GLOW
      let coreColor1 = 'rgba(168, 85, 247, 0.9)'; // Purple
      let coreColor2 = 'rgba(236, 72, 153, 0.8)'; // Pink
      let auraColor = 'rgba(139, 92, 246, 0.25)';

      if (state === 'listening') {
        coreColor1 = 'rgba(56, 189, 248, 0.95)'; // Sky blue
        coreColor2 = 'rgba(129, 140, 248, 0.9)'; // Indigo
        auraColor = `rgba(56, 189, 248, ${0.3 + audioLevel * 0.5})`;
      } else if (state === 'thinking') {
        coreColor1 = 'rgba(234, 179, 8, 0.95)'; // Amber/Gold
        coreColor2 = 'rgba(244, 114, 182, 0.9)'; // Pink
        auraColor = 'rgba(234, 179, 8, 0.35)';
      } else if (state === 'speaking') {
        coreColor1 = 'rgba(244, 63, 94, 0.95)'; // Rose
        coreColor2 = 'rgba(192, 132, 252, 0.9)'; // Violet
        auraColor = `rgba(244, 63, 94, ${0.25 + audioLevel * 0.6})`;
      } else if (state === 'error') {
        coreColor1 = 'rgba(239, 68, 68, 0.95)'; // Red
        coreColor2 = 'rgba(249, 115, 22, 0.85)'; // Orange
        auraColor = 'rgba(239, 68, 68, 0.3)';
      }

      // Outer Breathing Aura
      const breathing = Math.sin(phase * 0.8) * 6;
      const reactiveRadius = state === 'listening' || state === 'speaking'
        ? audioLevel * 25
        : 0;

      const baseRadius = (size / 3.4) + breathing + reactiveRadius;

      // Glow backdrop
      const radialGlow = ctx.createRadialGradient(cx, cy, baseRadius * 0.2, cx, cy, baseRadius * 1.8);
      radialGlow.addColorStop(0, auraColor);
      radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = radialGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Soundwaves / Waveform rings
      if (state === 'listening' || state === 'speaking') {
        const numRings = 3;
        for (let r = 1; r <= numRings; r++) {
          const ringRad = baseRadius + r * (14 + audioLevel * 20) + Math.sin(phase * 2 + r) * 3;
          ctx.beginPath();
          ctx.arc(cx, cy, ringRad, 0, Math.PI * 2);
          ctx.strokeStyle = state === 'listening'
            ? `rgba(56, 189, 248, ${0.4 / r + audioLevel * 0.4})`
            : `rgba(244, 63, 94, ${0.4 / r + audioLevel * 0.4})`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Thinking: Orbiting particles
      if (state === 'thinking') {
        particles.forEach((p) => {
          p.angle += p.speed;
          const px = cx + Math.cos(p.angle) * p.distance;
          const py = cy + Math.sin(p.angle) * (p.distance * 0.55);
          ctx.beginPath();
          ctx.arc(px, py, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(253, 224, 71, 0.85)';
          ctx.fill();
        });
      }

      // Core Organic Fluid Shape
      ctx.save();
      ctx.beginPath();
      const numSegments = 16;
      for (let i = 0; i <= numSegments; i++) {
        const theta = (i / numSegments) * Math.PI * 2;
        const wave = Math.sin(theta * 3 + phase * 1.5) * (4 + (state === 'speaking' ? audioLevel * 12 : 3));
        const rad = baseRadius + wave;
        const x = cx + Math.cos(theta) * rad;
        const y = cy + Math.sin(theta) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Fluid gradient fill
      const coreGradient = ctx.createLinearGradient(
        cx - baseRadius,
        cy - baseRadius,
        cx + baseRadius,
        cy + baseRadius
      );
      coreGradient.addColorStop(0, coreColor1);
      coreGradient.addColorStop(1, coreColor2);
      ctx.fillStyle = coreGradient;
      ctx.shadowBlur = 24;
      ctx.shadowColor = coreColor1;
      ctx.fill();
      ctx.restore();

      // Specular highlight highlight for 3D depth
      const specular = ctx.createRadialGradient(
        cx - baseRadius * 0.35,
        cy - baseRadius * 0.35,
        2,
        cx,
        cy,
        baseRadius * 0.9
      );
      specular.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
      specular.addColorStop(0.3, 'rgba(255, 255, 255, 0.15)');
      specular.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = specular;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 0.9, 0, Math.PI * 2);
      ctx.fill();

      animRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [state, audioLevel, size]);

  const getStateLabel = () => {
    switch (state) {
      case 'listening':
        return 'Listening to you...';
      case 'thinking':
        return 'Maya is thinking...';
      case 'speaking':
        return 'Maya is speaking...';
      case 'error':
        return 'Attention needed';
      case 'idle':
      default:
        return 'Tap or speak to Maya';
    }
  };

  const getStateIcon = () => {
    switch (state) {
      case 'listening':
        return <Mic className="w-4 h-4 text-sky-400 animate-pulse" />;
      case 'thinking':
        return <Sparkles className="w-4 h-4 text-amber-400 animate-spin" />;
      case 'speaking':
        return <Volume2 className="w-4 h-4 text-rose-400 animate-bounce" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      case 'idle':
      default:
        return <Radio className="w-4 h-4 text-purple-400" />;
    }
  };

  return (
    <div className="flex flex-col items-center justify-center select-none">
      <button
        type="button"
        onClick={onClick}
        aria-label={`AI Assistant Orb, current state: ${state}. Click to interact or interrupt.`}
        className="relative group focus:outline-none transition-transform active:scale-95 cursor-pointer"
        style={{ width: size, height: size }}
      >
        <canvas
          ref={canvasRef}
          width={size * 1.5}
          height={size * 1.5}
          style={{ width: size, height: size }}
          className="absolute inset-0 pointer-events-none drop-shadow-2xl"
        />

        {/* Center overlay icon on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="p-3 rounded-full bg-slate-900/70 border border-slate-700/80 backdrop-blur-md text-white shadow-xl">
            {state === 'speaking' ? (
              <span className="text-xs font-semibold px-1 text-rose-300">Tap to Interrupt</span>
            ) : state === 'listening' ? (
              <span className="text-xs font-semibold px-1 text-sky-300">Tap to Stop</span>
            ) : (
              <Mic className="w-6 h-6 text-purple-300" />
            )}
          </div>
        </div>
      </button>

      {/* Dynamic Status Pill */}
      <div className="mt-2 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 backdrop-blur-md shadow-md text-xs font-medium text-slate-200">
        {getStateIcon()}
        <span>{getStateLabel()}</span>
      </div>
    </div>
  );
};
