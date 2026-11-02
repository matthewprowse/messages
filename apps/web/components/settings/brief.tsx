"use client";

// Settings, AI, Daily Brief: when it is written, the voice and the speed, with a sample of each voice.

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { loadBriefSettings, sampleUrl, saveBriefSettings, SPEEDS, VOICES, type BriefSettings } from "@/lib/brief";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** When the daily brief is written, which voice reads it and how fast it plays, with a sample of each voice. */
export function BriefSection() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [settings, setSettings] = useState<BriefSettings | null>(null);
  const [sampling, setSampling] = useState(false);
  const sample = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (userId) void loadBriefSettings(userId).then(setSettings);
  }, [userId]);
  useEffect(() => () => sample.current?.pause(), []);

  // The time field edits locally and saves when it is left, so a half-typed time is never stored.
  const [time, setTime] = useState("07:00");
  useEffect(() => { if (settings) setTime(settings.time); }, [settings]);

  // Shown at once, then saved; a failed save puts back what was there.
  const save = async (patch: Partial<BriefSettings>) => {
    if (!userId || !settings) return;
    const before = settings;
    setSettings({ ...before, ...patch });
    if (!(await saveBriefSettings(userId, patch))) {
      setSettings((now) => (now ? { ...now, ...Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof BriefSettings]])) } : now));
      if (patch.time !== undefined) setTime(before.time);
      toast("Could not save. Check your connection and try again.");
    }
  };
  const saveTime = () => { if (settings && /^\d{2}:\d{2}$/.test(time) && time !== settings.time) void save({ time }); };

  const playSample = () => {
    if (!settings) return;
    if (sampling) { sample.current?.pause(); return; }
    sample.current?.pause();
    const el = new Audio(sampleUrl(settings.voice));
    el.playbackRate = settings.speed;
    el.onplay = () => setSampling(true);
    el.onpause = () => setSampling(false);
    el.onended = () => setSampling(false);
    sample.current = el;
    void el.play();
  };

  return (
    <SettingsSection id="daily-brief" title="Daily Brief" description="A short spoken summary of your day, ready on the Summary page each morning.">
      {!settings ? <Skeleton className="h-40 w-full rounded-lg" /> : <SettingsRows>
        <SettingsRow title="Time" description="Written each morning at this time.">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} onBlur={saveTime} className="w-28" aria-label="Brief Time" />
        </SettingsRow>
        <SettingsRow title="Voice" description="Used from the next brief. Play a sample to hear it.">
          <Button variant="secondary" size="icon" onClick={playSample} aria-label={sampling ? "Stop Sample" : "Play Sample"}>
            {sampling ? <Pause /> : <Play />}
          </Button>
          <Select value={settings.voice} onValueChange={(voice) => { sample.current?.pause(); void save({ voice }); }}>
            <SelectTrigger className="w-44" aria-label="Voice"><SelectValue /></SelectTrigger>
            <SelectContent>
              {VOICES.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Speed" description="How fast the brief plays.">
          <Select value={String(settings.speed)} onValueChange={(v) => { if (sample.current) sample.current.playbackRate = Number(v); void save({ speed: Number(v) }); }}>
            <SelectTrigger className="w-28" aria-label="Speed"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SPEEDS.map((s) => <SelectItem key={s} value={String(s)}>{`${s}x`}</SelectItem>)}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsRows>}
    </SettingsSection>
  );
}
