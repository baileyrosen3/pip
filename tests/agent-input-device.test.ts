import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

const python = String.raw`
import importlib.machinery
import importlib.util
import pathlib
import sys
import types

# Import the agent without requiring GI, Hyprland, GLib startup, or a real device.
gi = types.ModuleType('gi')
gi.__spec__ = importlib.machinery.ModuleSpec('gi', loader=None, is_package=True)
gi.__path__ = []
gi.require_version = lambda *args: None
repository = types.ModuleType('gi.repository')
repository.GLib = types.SimpleNamespace()
repository.Atspi = types.SimpleNamespace()
sys.modules['gi'] = gi
sys.modules['gi.repository'] = repository

desktop = types.ModuleType('desktop')
desktop.desktop_environment = lambda: None
desktop.Hyprland = type('Hyprland', (), {})
desktop.UInput = type('UInput', (), {})
desktop.FocusTracker = type('FocusTracker', (), {})
desktop.key_command = lambda *args: None
desktop.run_wtype = lambda *args: None
sys.modules['desktop'] = desktop

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('pip_agent', path)
agent_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_module)

agent = agent_module.Agent.__new__(agent_module.Agent)
agent.uinput = None
agent.input_error = 'initial permission denial'
attempts = []
permission_granted = False
class FakeUInput:
    def __init__(self):
        attempts.append('open')
        if not permission_granted:
            raise PermissionError('permission denied')

def open_fake():
    return FakeUInput()
agent_module.UInput = open_fake
for expected_attempts in (1, 2):
    try:
        agent.input_device()
    except RuntimeError as error:
        assert str(error) == 'Cannot open /dev/uinput: permission denied', str(error)
    else:
        raise AssertionError('failed device open unexpectedly succeeded')
    assert len(attempts) == expected_attempts, attempts
    assert agent.input_error == 'permission denied', agent.input_error

permission_granted = True
device = agent.input_device()
assert len(attempts) == 3, attempts
assert agent.input_error is None, agent.input_error
assert agent.input_device() is device
assert len(attempts) == 3, attempts
`;

test('input_device retries failed uinput opens and reuses the recovered device', async () => {
  const child = Bun.spawn(['python3', '-c', python, resolve(import.meta.dir, '../agent/pip_agent.py')], {
    cwd: resolve(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr || stdout).toBe(0);
});