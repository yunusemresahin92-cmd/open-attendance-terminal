import test from 'node:test';
import assert from 'node:assert/strict';
import { canSee, normalizePermissions } from './data.js';

test('settings and employee deletion are independent permissions', () => {
  const settingsUser = { admin: false, menus: ['settings'] };
  assert.equal(canSee(settingsUser, 'settings'), true);
  assert.equal(canSee(settingsUser, 'deleteEmployee'), false);
  assert.equal(canSee(settingsUser, 'employees'), false);
  assert.equal(canSee({ admin: true, menus: [] }, 'deleteEmployee'), true);
});

test('employee deletion also grants the employee menu and rejects unknown permissions', () => {
  assert.deepEqual(normalizePermissions(['deleteEmployee', 'deleteEmployee', 'unknown']), ['deleteEmployee', 'employees']);
});
