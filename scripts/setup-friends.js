#!/usr/bin/env node
/**
 * Setup script: creates friend accounts and adds them to the "zbar_round_one" lobby.
 *
 * Usage:
 *   node scripts/setup-friends.js
 *
 * This script:
 * 1. Creates user accounts with the provided names/passwords
 * 2. Creates the "zbar_round_one" game (play mode) if it doesn't exist
 * 3. Adds all created users to the game as members
 * 4. Allows late joiners (allowLateJoin: true)
 *
 * Edit the FRIENDS array below with your friends' names and passwords.
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

// Load .env if present
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// EDIT THIS ARRAY: Add your friends' names and passwords
// ============================================================================
const FRIENDS = [
  { name: 'Cayden', password: 'cayden123' },
  // Add more friends here:
  // { name: 'Friend2', password: 'password2' },
];

// ============================================================================
// Game configuration for "zbar_round_one"
// ============================================================================
const GAME_CONFIG = {
  name: 'zbar_round_one',
  mode: 'play',
  config: {
    board: 8,
    startingHp: 3,
    startingAp: 0,
    baseRange: 2,
    apPerDay: 1,
    upgradeCost: 2,
    apIntervalMinutes: 0,
    // Add bots to fill the lobby:
    bots: [
      { difficulty: 'easy' },
      { difficulty: 'easy' },
      { difficulty: 'medium' },
    ],
  },
  allowLateJoin: true,
};

// ============================================================================
// Main script
// ============================================================================

async function main() {
  console.log('🎮 Setting up zbar_round_one lobby...\n');

  // Step 1: Create user accounts
  console.log('📝 Creating user accounts...');
  const users = [];
  for (const friend of FRIENDS) {
    try {
      const { data, error } = await admin.auth.admin.createUser({
        email: `${friend.name.toLowerCase().replace(/\s+/g, '.')}@tank-turn.game`,
        password: friend.password,
        user_metadata: { name: friend.name },
        app_metadata: {},
        is_anonymous: false,
        email_confirm: false, // they'll get a confirmation email
      });

      if (error) {
        console.error(`❌ Failed to create user "${friend.name}": ${error.message}`);
        continue;
      }

      console.log(`✅ Created user: ${friend.name} (${data.user.id})`);
      users.push({
        name: friend.name,
        id: data.user.id,
        password: friend.password,
      });
    } catch (err) {
      console.error(`❌ Error creating user "${friend.name}": ${err.message}`);
    }
  }

  if (users.length === 0) {
    console.error('❌ No users were created. Aborting.');
    process.exit(1);
  }

  // Step 2: Create or get the "zbar_round_one" game
  console.log('\n🎯 Creating/getting "zbar_round_one" game...');

  // Check if game already exists
  const { data: existingGames, error: findError } = await admin
    .from('games')
    .select('id')
    .eq('name', GAME_CONFIG.name)
    .limit(1);

  let gameId;
  if (existingGames && existingGames.length > 0) {
    gameId = existingGames[0].id;
    console.log(`✅ Game "zbar_round_one" already exists: ${gameId}`);
  } else {
    // Create the game
    const { data: newGame, error: createError } = await admin
      .from('games')
      .insert({
        name: GAME_CONFIG.name,
        mode: GAME_CONFIG.mode,
        config: GAME_CONFIG.config,
        status: 'lobby',
        created_by: users[0].id, // first user is the host
        daily_ap_time: '09:00',
        ap_interval_minutes: null,
        invite_code: `zbar-round-${Date.now().toString(36)}`,
      })
      .select('id')
      .single();

    if (createError) {
      console.error(`❌ Failed to create game: ${createError.message}`);
      process.exit(1);
    }

    gameId = newGame.id;
    console.log(`✅ Created game "zbar_round_one": ${gameId}`);
  }

  // Step 3: Add all users as members
  console.log('\n👥 Adding users to the lobby...');
  for (const user of users) {
    try {
      // Check if already a member
      const { data: existingMember } = await admin
        .from('game_players')
        .select('player_id')
        .eq('game_id', gameId)
        .eq('player_id', user.id)
        .limit(1);

      if (existingMember && existingMember.length > 0) {
        console.log(`⏭️  ${user.name} is already a member`);
        continue;
      }

      const { error } = await admin.from('game_players').insert({
        game_id: gameId,
        player_id: user.id,
      });

      if (error) {
        console.error(`❌ Failed to add ${user.name}: ${error.message}`);
      } else {
        console.log(`✅ Added ${user.name} to lobby`);
      }
    } catch (err) {
      console.error(`❌ Error adding ${user.name}: ${err.message}`);
    }
  }

  // Step 4: Set allowLateJoin flag in game config
  console.log('\n🔓 Enabling late joiners...');
  const { error: updateError } = await admin
    .from('games')
    .update({ config: { ...GAME_CONFIG.config, allowLateJoin: true } })
    .eq('id', gameId);

  if (updateError) {
    console.error(`❌ Failed to enable late joiners: ${updateError.message}`);
  } else {
    console.log('✅ Late joiners enabled');
  }

  // Step 5: Summary
  console.log('\n📋 Summary:');
  console.log(`   Game: ${GAME_CONFIG.name}`);
  console.log(`   Mode: ${GAME_CONFIG.mode}`);
  console.log(`   Members: ${users.length} users`);
  console.log(`   Bots: ${GAME_CONFIG.config.bots?.length || 0} pre-filled`);
  console.log(`   Late joiners: Enabled`);
  console.log('\n✅ Setup complete!');
  console.log('\n💡 Next steps:');
  console.log('   - Share these login credentials with your friends:');
  for (const user of users) {
    console.log(`     ${user.name}: ${user.password}`);
  }
  console.log('   - Invite code: Check the games table for the invite_code');
  console.log('   - To start the game: Host calls game-start API');
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
