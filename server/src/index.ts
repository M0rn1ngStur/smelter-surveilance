import 'dotenv/config';
import { initializeSmelterInstance } from './smelter';
import { app } from './routes';

async function run() {
  await initializeSmelterInstance();

  app.listen(3000, () => {
    console.log('Server listening on http://localhost:3000');
  });
}

void run();
