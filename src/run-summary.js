import 'dotenv/config';
import { runDailySummary } from './summaryJob.js';

runDailySummary()
  .then((result) => {
    console.log('Done:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
