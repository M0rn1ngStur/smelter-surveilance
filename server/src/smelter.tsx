import Smelter from '@swmansion/smelter-node';
import App from './App';

export const SmelterInstance = new Smelter();
export let whepEndpointRoute: string = '';

export async function initializeSmelterInstance() {
  await SmelterInstance.init();

  const result = await SmelterInstance.registerOutput('output_1', <App />, {
    type: 'whep_server',
    video: {
      encoder: {
        type: 'ffmpeg_h264',
        preset: 'ultrafast',
      },
      resolution: {
        width: 1920,
        height: 1080,
      },
    },
  });

  whepEndpointRoute = result.endpointRoute;

  await SmelterInstance.start();
}
