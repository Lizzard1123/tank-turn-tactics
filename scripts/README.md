# Setup Script

## setup-friends.js

Creates friend accounts and adds them to the "zbar_round_one" lobby.

### Usage

1. Edit `.env` with your Supabase credentials:
   ```bash
   SUPABASE_URL=https://sifbpmpxyiycbupntobl.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

2. Edit `scripts/setup-friends.js` and update the `FRIENDS` array:
   ```javascript
   const FRIENDS = [
     { name: 'Cayden', password: 'cayden123' },
     { name: 'Friend2', password: 'password2' },
   ];
   ```

3. Run the script:
   ```bash
   node scripts/setup-friends.js
   ```

### What it does

1. Creates user accounts with the provided names/passwords
2. Creates the "zbar_round_one" game (play mode) if it doesn't exist
3. Adds all created users to the game as members
4. Enables late joiners (allowLateJoin: true)

### Notes

- The first user in the `FRIENDS` array becomes the game host
- Bots are pre-filled in the game config (3 easy bots)
- Late joiners are enabled by default
- Share login credentials with your friends
