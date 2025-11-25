import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Generate a new random private key
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log('\n=== New Wallet Generated ===\n');
console.log('Address:', account.address);
console.log('Private Key:', privateKey);
console.log('\n⚠️  IMPORTANT: Keep your private key secure and never share it!\n');
console.log('Add this to your .env file:');
console.log(`PRIVATE_KEY=${privateKey}`);
console.log('\n');
