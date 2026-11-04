import './ui/styles.css';
import { Game } from './game';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
if (!webglAvailable()) {
  document.getElementById('ui')!.innerHTML =
    '<div class="screen"><div class="panel modal"><h2>WebGL unavailable</h2><p>Skyharbor needs a browser with WebGL enabled. Try a recent Chrome, Firefox, Edge or Safari.</p></div></div>';
} else {
  const game = new Game(canvas);
  game.start();
  // Browsers only allow audio after a user gesture.
  const unlock = () => {
    game.audio.start();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
