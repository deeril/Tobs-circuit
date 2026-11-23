const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function businessDriverConversationId(adminId, driverId) {
  if (!UUID_PATTERN.test(adminId || '') || !UUID_PATTERN.test(driverId || '')) return null;
  return `business-driver:${adminId}:${driverId}`;
}

export function resolveBusinessDriverConversation(conversationId, user, users) {
  const match = typeof conversationId === 'string'
    ? conversationId.match(/^business-driver:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
    : null;
  if (!match || !user || !Array.isArray(users)) return null;

  const [, adminId, driverId] = match;
  const admin = users.find(item =>
    item.id === adminId && item.role === 'ADMIN' && item.status === 'ACTIVE'
  );
  const driver = users.find(item =>
    item.id === driverId && item.role === 'DRIVER' && item.status === 'ACTIVE'
  );
  if (!admin || !driver || driver.ownerAdminId !== admin.id) return null;
  if (user.id !== admin.id && user.id !== driver.id) return null;

  return {
    adminId: admin.id,
    driverId: driver.id,
    businessId: admin.id,
    riderId: driver.id,
    recipientId: user.id === admin.id ? driver.id : admin.id
  };
}
