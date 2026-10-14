import { startServer, type BrainKind } from '../tests/harness';
import type { Phone } from '../tests/harness/phone';

/** Opt-in paid API check. All desktop operations use the isolated, non-interactive fake helper. */
export async function smokeBrain(kind: BrainKind) {
  const openai = process.env.OPENAI_API_KEY;
  const gemini = process.env.GEMINI_API_KEY;
  if (!openai) throw new Error('Set OPENAI_API_KEY (also needed to render the spoken questions).');
  if (kind === 'gemini' && !gemini) throw new Error('Set GEMINI_API_KEY.');
  const redact = (text: string) => {
    for (const key of [openai, gemini]) if (key) text = text.replaceAll(key, '[REDACTED]');
    return text.replace(/sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+/g, '[REDACTED]');
  };
  const pip = await startServer({
    brain: { kind, baseURL: '' }, keys: { openai, gemini }, desktop: 'fake',
    settings: { voice: true, autoSleep: 0, notes: false, computerControl: false },
  });
  let phone: Phone | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const failed = Promise.withResolvers<never>();
  try {
    phone = await pip.phone();
    const client = phone;
    void client.waitFor('error', () => true, 180_000).then(value => failed.reject(new Error(String(value.message))), error => { if (!stopped) failed.reject(error); });
    // Keep the full-duplex timeline moving, even while listening to Pip's reply.
    let microphone = new Uint8Array(0), offset = 0, streamed: (() => void) | undefined;
    let audioCount = 0, lastAudioAt = 0, playing = false;
    timer = setInterval(() => {
      if (offset < microphone.length) {
        client.streamPCM(microphone.subarray(offset, offset + 960)); offset += 960;
        if (offset >= microphone.length) { streamed?.(); streamed = undefined; }
      } else client.streamPCM(new Int16Array(480));
      if (client.audio.length !== audioCount) {
        audioCount = client.audio.length; lastAudioAt = Date.now();
        if (!playing) { playing = true; client.send({ t: 'playback', on: true }); }
      } else if (playing && Date.now() - lastAudioAt > 650) {
        playing = false; client.send({ t: 'playback', on: false });
      }
    }, 20);
    client.wake();
    await Promise.race([client.waitFor('mic', value => value.on === true, 30_000), failed.promise]);
    for (const [label, question] of [
      ['spoken', 'Pip, what is two plus two?'],
      ['screen', 'Pip, what app is focused on my screen? Look at my screen to check.'],
    ]) {
      const response = await Promise.race([fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${openai}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: question, response_format: 'pcm' }),
        signal: AbortSignal.timeout(90_000),
      }), failed.promise]);
      if (!response.ok) throw new Error(`Question TTS failed (${response.status}): ${await response.text()}`);
      const pcm = new Uint8Array(await response.arrayBuffer());
      if (!pcm.length || pcm.length % 2) throw new Error('Question TTS did not return PCM16/24 kHz.');
      const beforeAudio = client.audio.length, beforeActivity = client.messages('activity').length;
      client.askStart();
      const sent = new Promise<void>(resolve => { microphone = pcm; offset = 0; streamed = resolve; });
      await Promise.race([sent, failed.promise]);
      await Bun.sleep(400);
      client.askEnd();
      const deadline = Date.now() + 90_000;
      let caption = '', verified = false;
      while (Date.now() < deadline) {
        const value = await Promise.race([client.waitFor('caption', value => value.done === true && typeof value.text === 'string' && value.text.trim().length > 0, Math.max(1, deadline - Date.now())), failed.promise]);
        caption = String(value.text);
        // GPT-Live can caption a brief backchannel before the delegated answer arrives.
        const looked = client.messages('activity').slice(beforeActivity).some(value => value.name === 'looking');
        if (label === 'screen' && (!looked || !/smoke\s*editor/i.test(caption))) continue;
        if (label === 'spoken' && !/\bfour\b|\b4\b/i.test(caption)) continue;
        verified = true;
        break;
      }
      if (!verified) throw new Error(`${label}: no verified final caption.`);
      await Bun.sleep(800);
      const speechBytes = client.audio.slice(beforeAudio).reduce((sum, frame) => sum + frame.length, 0);
      if (!speechBytes) throw new Error(`${label}: talk out loud was on, but no speech audio arrived.`);
      console.log(redact(`${kind} ${label}: PASS — caption: ${caption} — speech ${speechBytes} bytes (PCM16/24 kHz)${label === 'screen' ? ' — look_at_screen confirmed' : ''}`));
      while (playing && Date.now() < deadline) await Promise.race([Bun.sleep(100), failed.promise]);
      if (playing) throw new Error(`${label}: speech playback did not drain.`);
    }
    client.sleep();
    await client.waitFor('state', value => value.state === 'asleep', 5000);
    // Keep the isolated process alive through the documented GPT-Live close timeout.
    if (kind === 'gptlive') await Bun.sleep(15_100);
  } catch (error) {
    const text = redact(error instanceof Error ? error.message : String(error));
    if (kind === 'gemini' && /billing on and no credits|prepayment credits (?:are )?depleted/i.test(text + pip.logs())) {
      console.log('gemini: BLOCKED — project billing has no prepaid credits (1011). Use a free-tier project key or add credits.');
      process.exitCode = 2;
    } else {
      console.error(redact(`${kind}: FAIL — ${text}\n${pip.logs()}`));
      process.exitCode = 1;
    }
  } finally {
    stopped = true; clearInterval(timer);
    phone?.sleep();
    await pip.stop();
  }
}
