import { expect, test } from 'bun:test';
import { mockBrain, startServer, type PipServer } from './harness';
import type { ChecksFixture } from './harness/server';

const healthy: ChecksFixture = {
  commands: {
    'pacman -Q tesseract tesseract-data-eng wtype grim ffmpeg imagemagick qrencode bun python-gobject at-spi2-core tailscale': 'tesseract 5.5.0\ntesseract-data-eng 4.1.0\nwtype 0.4\ngrim 1.4\nffmpeg 8\nimagemagick 7\nqrencode 4\nbun 1.3\npython-gobject 3\nat-spi2-core 2\ntailscale 1\n',
    'tailscale status --json': JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pip.example.ts.net.' }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: ['pip.example.ts.net'] }),
    'hyprctl version -j': JSON.stringify({ version: '0.56.0' }),
    'quickshell --version': 'quickshell 0.3.0\n',
  },
  path: '/fixture/bin', writable: ['/dev/uinput'], executable: ['/fixture/bin/pipctl'],
};

async function scenario(fixture: ChecksFixture, observe: (pip: PipServer) => Promise<void>) {
  const brain = mockBrain('gemini');
  const pip = await startServer({ brain, checks: fixture });
  try { await observe(pip); }
  finally { await pip.stop(); await brain.stop(); }
}

test('missing packages appear in status with the exact visible installation command', async () => {
  await scenario({ ...healthy, commands: { ...healthy.commands,
    'pacman -Q tesseract tesseract-data-eng wtype grim ffmpeg imagemagick qrencode bun python-gobject at-spi2-core tailscale': null,
    'pacman -Q tesseract': 'tesseract 5', 'pacman -Q tesseract-data-eng': 'tesseract-data-eng 4',
    'pacman -Q grim': 'grim 1', 'pacman -Q ffmpeg': 'ffmpeg 8', 'pacman -Q imagemagick': 'imagemagick 7',
    'pacman -Q qrencode': 'qrencode 4', 'pacman -Q bun': 'bun 1', 'pacman -Q python-gobject': 'python-gobject 3',
    'pacman -Q at-spi2-core': 'at-spi2-core 2', 'pacman -Q tailscale': 'tailscale 1',
  } }, async pip => {
    const status = await (await pip.request('/api/status')).json();
    expect(status.checks).toContainEqual({ id: 'packages', ok: false, title: 'Required packages', detail: 'Missing: wtype', fix: { label: 'Install packages', command: 'omarchy pkg add wtype' } });
    const phone = await pip.phone();
    expect((await phone.waitFor('hello')).setup).toBe('finish setup on your computer');
  });
});

test('unwritable uinput is reported with Pip-owned rule and modules-load installation', async () => {
  await scenario({ ...healthy, writable: [] }, async pip => {
    const status = await (await pip.request('/api/status')).json();
    expect(status.checks).toContainEqual(expect.objectContaining({
      id: 'uinput', ok: false, title: 'Computer control permission',
      detail: '/dev/uinput is not writable by your user.',
      fix: { label: 'Allow computer control', command: `sudo install -m644 '${process.cwd()}/system/70-pip-uinput.rules' /etc/udev/rules.d/ && sudo install -m644 '${process.cwd()}/system/pip-uinput.conf' /etc/modules-load.d/ && sudo modprobe uinput && sudo udevadm control --reload && sudo udevadm trigger --name-match=uinput` },
    }));
  });
});

test('pipctl missing from PATH offers the plugin CLI symlink', async () => {
  await scenario({ ...healthy, executable: [] }, async pip => {
    const status = await (await pip.request('/api/status')).json();
    expect(status.checks).toContainEqual({
      id: 'pipctl', ok: false, title: 'pipctl on PATH', detail: 'Your PATH does not contain an executable pipctl.',
      fix: { label: 'Put pipctl on PATH', command: `mkdir -p ~/.local/bin && ln -sf '${process.cwd()}/bin/pipctl' ~/.local/bin/pipctl` },
    });
  });
});

for (const state of [
  { name: 'unavailable', output: null, detail: 'Install and sign in to Tailscale; enable MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns.' },
  { name: 'stopped', output: JSON.stringify({ BackendState: 'Stopped' }), detail: 'Tailscale is Stopped. Run the service installer, then sign in.' },
  { name: 'MagicDNS disabled', output: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pip.example.ts.net.' }, CurrentTailnet: { MagicDNSEnabled: false }, CertDomains: ['pip.example.ts.net'] }), detail: 'Enable MagicDNS at https://login.tailscale.com/admin/dns.' },
  { name: 'HTTPS disabled', output: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pip.example.ts.net.' }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: [] }), detail: 'Enable HTTPS Certificates at https://login.tailscale.com/admin/dns.' },
]) {
  test(`phone access checklist explains Tailscale ${state.name}`, async () => {
    await scenario({ ...healthy, commands: { ...healthy.commands, 'tailscale status --json': state.output } }, async pip => {
      const status = await (await pip.request('/api/status')).json();
      expect(status.checks).toContainEqual({
        id: 'tailscale', ok: false, title: 'Tailscale phone access', detail: state.detail,
        fix: state.name === 'unavailable' || state.name === 'stopped'
          ? { label: 'Set up Tailscale', command: 'omarchy-install-service-tailscale' }
          : { label: 'Open Tailscale DNS settings', command: 'xdg-open https://login.tailscale.com/admin/dns' },
      });
    });
  });
}

test('older Hyprland reports both installed and required versions', async () => {
  await scenario({ ...healthy, commands: { ...healthy.commands, 'hyprctl version -j': JSON.stringify({ version: '0.55.2' }) } }, async pip => {
    const status = await (await pip.request('/api/status')).json();
    expect(status.checks).toContainEqual({
      id: 'hyprland', ok: false, title: 'Hyprland 0.56+', detail: 'Hyprland 0.55.2 is installed; Pip needs 0.56 or newer.',
      fix: { label: 'Update Omarchy', command: 'omarchy update' },
    });
  });
});

test('older Quickshell reports its minimum version', async () => {
  await scenario({ ...healthy, commands: { ...healthy.commands, 'quickshell --version': 'quickshell 0.2.1' } }, async pip => {
    const status = await (await pip.request('/api/status')).json();
    expect(status.checks).toContainEqual({
      id: 'quickshell', ok: false, title: 'Quickshell 0.3+', detail: 'Quickshell 0.2.1 is installed; Pip needs 0.3 or newer.',
      fix: { label: 'Update Omarchy', command: 'omarchy update' },
    });
  });
});

test('complete setup sends phones only an ok summary', async () => {
  await scenario(healthy, async pip => {
    const status = await (await pip.request('/api/status')).json();
    expect(status.checks.map((check: { id: string }) => check.id)).toEqual(['packages', 'uinput', 'pipctl', 'tailscale', 'hyprland', 'quickshell']);
    expect(status.checks.every((check: { ok: boolean }) => check.ok)).toBe(true);
    const hello = await (await pip.phone()).waitFor('hello');
    expect(hello.setup).toBe('ok');
    expect(hello.checks).toBeUndefined();
  });
});

test('Check again reevaluates the environment and updates connected phones', async () => {
  await scenario({ ...healthy, commands: { ...healthy.commands, 'hyprctl version -j': [
    JSON.stringify({ tag: 'v0.55.2' }), JSON.stringify({ tag: 'v0.56.0' }),
  ] } }, async pip => {
    const phone = await pip.phone();
    expect((await phone.waitFor('hello')).setup).toBe('finish setup on your computer');
    expect((await pip.request('/api/ctl', { method: 'POST', body: JSON.stringify({ cmd: 'check' }) })).status).toBe(200);
    expect((await phone.waitFor('setup')).setup).toBe('ok');
    expect((await (await pip.request('/api/status')).json()).setup).toBe('ok');
  });
});

test('bar shell status contains the checklist and Check again refreshes it', async () => {
  await scenario({ ...healthy, commands: { ...healthy.commands, 'hyprctl version -j': [
    JSON.stringify({ tag: 'v0.55.2' }), JSON.stringify({ tag: 'v0.56.0' }),
  ] } }, async pip => {
    const phone = await pip.phone();
    await phone.waitFor('hello');
    const received = Promise.withResolvers<Record<string, unknown>>();
    let buffer = '';
    const socket = await Bun.connect({ unix: pip.shellSocket, socket: {
      open(socket) { socket.write(JSON.stringify({ ev: 'hello', role: 'bar' }) + '\n'); },
      data(_socket, bytes) {
        buffer += new TextDecoder().decode(bytes);
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const packet = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
          if (packet.op === 'status') received.resolve(packet);
        }
      },
      error(_socket, error) { received.reject(error); },
    } });
    try {
      expect((await received.promise).checks).toContainEqual(expect.objectContaining({ id: 'hyprland', ok: false }));
      socket.write(JSON.stringify({ ev: 'ctl', cmd: 'check' }) + '\n');
      expect((await phone.waitFor('setup')).setup).toBe('ok');
    } finally { socket.end(); }
  });
});
