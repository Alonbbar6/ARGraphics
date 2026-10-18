import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, LoaderCircle, RefreshCw, SwitchCamera, X } from 'lucide-react';
import { cameraProblem, cameraSupported, captureFrame, hasMultipleCameras, openCamera, stopCamera, type Facing } from '@/lib/camera';

/**
 * Live viewfinder with a shutter. On a phone it opens the back camera; on a laptop, the
 * webcam. A captured frame is handed back as a JPEG File and the stream is closed. When the
 * camera cannot open, the owner is offered the file picker instead (which on a phone still
 * opens the native camera through `capture`).
 */
export function CameraCapture({ subject, onCapture, onPickFile, onCancel, accept }: {
  subject: string;
  onCapture: (file: File) => void;
  onPickFile: (file: File) => void;
  onCancel: () => void;
  accept: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [status, setStatus] = useState<'starting' | 'live' | 'blocked'>('starting');
  const [problem, setProblem] = useState('');
  const [canFlip, setCanFlip] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);

  const start = useCallback(async (nextFacing: Facing) => {
    stopCamera(streamRef.current);
    streamRef.current = null;
    setStatus('starting');
    setProblem('');
    if (!cameraSupported()) {
      setStatus('blocked');
      setProblem('This browser cannot open the camera here. Choose a photo from your library instead.');
      return;
    }
    try {
      const stream = await openCamera(nextFacing);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stopCamera(stream); return; }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStatus('live');
      setCanFlip(await hasMultipleCameras());
    } catch (error) {
      setStatus('blocked');
      setProblem(cameraProblem(error));
    }
  }, []);

  useEffect(() => {
    void start(facing);
    return () => { stopCamera(streamRef.current); streamRef.current = null; };
  }, [facing, start]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const snap = async () => {
    const video = videoRef.current;
    if (!video || status !== 'live') return;
    setSnapping(true);
    try {
      const file = await captureFrame(video, subject, facing);
      setPreview({ file, url: URL.createObjectURL(file) });
      stopCamera(streamRef.current);
      streamRef.current = null;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The photo could not be taken. Try again.');
    } finally {
      setSnapping(false);
    }
  };

  const retake = () => {
    setPreview(null);
    void start(facing);
  };

  const use = () => {
    if (!preview) return;
    onCapture(preview.file);
  };

  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-border bg-background" aria-label="Camera" data-testid="panel-camera">
      <div className="relative aspect-[4/3] w-full bg-black">
        {preview ? (
          <img src={preview.url} alt={`Photo of ${subject}`} className="h-full w-full object-contain" />
        ) : (
          <video ref={videoRef} playsInline muted autoPlay className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`} aria-label="Live camera" />
        )}
        {status === 'starting' && !preview && (
          <div className="absolute inset-0 grid place-items-center text-white/80" role="status"><LoaderCircle className="animate-spin" size={26} aria-label="Starting the camera" /></div>
        )}
        {status === 'blocked' && (
          <div className="absolute inset-0 grid place-items-center p-5 text-center text-sm text-white/85" role="alert" data-testid="status-camera-blocked">
            <p>{problem}</p>
          </div>
        )}
        {status === 'live' && !preview && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
            <span className="h-[62%] w-[62%] rounded-[2rem] border-2 border-white/35" />
          </div>
        )}
        <button type="button" onClick={onCancel} className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70" aria-label="Close camera"><X size={19} /></button>
        {canFlip && status === 'live' && !preview && (
          <button type="button" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')} className="absolute left-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70" aria-label="Switch camera"><SwitchCamera size={19} /></button>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        {preview ? (
          <>
            <p className="text-sm text-muted-foreground">Glass edge sharp, garnish in frame? Then let’s build it.</p>
            <div className="flex gap-2">
              <button type="button" onClick={retake} className="flex min-h-12 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted" data-testid="button-camera-retake"><RefreshCw size={16} /> Retake</button>
              <button type="button" onClick={use} className="flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground" data-testid="button-camera-use"><Camera size={17} /> Use this photo</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{status === 'live' ? 'Fill the frame with the dish on a plain surface, in good light.' : status === 'blocked' ? 'You can still pick a photo you already took.' : 'Opening the camera…'}</p>
            <div className="flex gap-2">
              <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted" data-testid="button-camera-library">
                <ImagePlus size={16} /> Library
                <input className="sr-only" type="file" accept={accept} capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onPickFile(file); }} />
              </label>
              <button type="button" onClick={() => void snap()} disabled={status !== 'live' || snapping} className="flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-camera-shutter">
                {snapping ? <LoaderCircle size={17} className="animate-spin" /> : <Camera size={17} />} Take the photo
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
