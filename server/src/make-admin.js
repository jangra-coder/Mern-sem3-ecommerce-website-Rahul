// Gives an existing account admin rights:   npm run make-admin -- you@example.com
// Take them away again with:                npm run make-admin -- you@example.com --remove
import mongoose from 'mongoose';
import { config } from './config.js';
import { User } from './models.js';

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run make-admin -- <email> [--remove]');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);
const isAdmin = flag !== '--remove';
const user = await User.findOneAndUpdate({ email: String(email).trim().toLowerCase() }, { $set: { isAdmin } });
console.log(
  user
    ? `${user.email} is ${isAdmin ? 'now an admin' : 'no longer an admin'}.`
    : `No account found for ${email}. Create the account on the website first.`
);
await mongoose.disconnect();
process.exit(user ? 0 : 1);
