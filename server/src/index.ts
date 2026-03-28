import 'dotenv/config';
import { initializeSmelterInstance } from './smelter';
import { app } from './routes';

async function run() {
  await initializeSmelterInstance();

  app.listen(3000, () => {
    console.log('Sender:  http://localhost:3000/sender.html');
    console.log('Viewer:  http://localhost:3000/viewer.html');
  });
}

void run();
