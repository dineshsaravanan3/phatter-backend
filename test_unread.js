async function test() {
  const email = 'admin@collabhq.com';
  const password = 'Password123!';
  const baseUrl = 'http://localhost:4000';
    'Authorization'; `Bearer ${token}`,
    'Content-Type'; 'application/json'
  };

  console.log('\n2. Fetching initial conversations...');
  const convRes1 = await fetch(`${baseUrl}/chat/conversations`, { headers });
  const conversations = await convRes1.json();
  console.log(`Fetched ${conversations.length} conversations.`);

  const unread = conversations.filter(c => c.unreadCount > 0);
  console.log(`Found ${unread.length} unread conversations:`);
  unread.forEach(c => {
    console.log(`  - Name: ${c.name}, ID: ${c.id}, Type: ${c.type}, unreadCount: ${c.unreadCount}`);
  });

  if (unread.length === 0) {
    console.log('No unread conversations found to test with.');
    return;
  }

  const target = unread[0];
  console.log(`\n3. Marking channel "${target.name}" (${target.id}) as read...`);
  const patchRes = await fetch(`${baseUrl}/chat/channels/${target.id}/read`, {
    method: 'PATCH',
    headers
  });
  const patchData = await patchRes.json();
  console.log('PATCH response:', patchData);

  console.log('\n4. Fetching conversations immediately after marking as read...');
  const convRes2 = await fetch(`${baseUrl}/chat/conversations`, { headers });
  const conversations2 = await convRes2.json();
  const targetAfter1 = conversations2.find(c => c.id === target.id);
  console.log(`  - Name: ${targetAfter1.name}, unreadCount: ${targetAfter1.unreadCount}`);

  console.log('\n5. Waiting 2 seconds and fetching conversations again...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  const convRes3 = await fetch(`${baseUrl}/chat/conversations`, { headers });
  const conversations3 = await convRes3.json();
  const targetAfter2 = conversations3.find(c => c.id === target.id);
  console.log(`  - Name: ${targetAfter2.name}, unreadCount: ${targetAfter2.unreadCount}`);


test().catch(console.error);
