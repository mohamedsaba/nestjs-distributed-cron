export const RENEW_LUA = `-- ARGV[1]: instanceId
-- ARGV[2]: newTTL (milliseconds)
-- KEYS[1]: lock key
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end`;

export const RELEASE_LUA = `-- ARGV[1]: instanceId
-- KEYS[1]: lock key
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`;
