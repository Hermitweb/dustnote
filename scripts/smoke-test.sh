#!/bin/bash
# 端到端冒烟测试：验证 update-manifest API + 强制升级
# 启动后端 → 等待 ready → curl 测试 → 关闭

set -e

cd "$(dirname "$0")/.."

echo "▶ 编译 shared + server"
pnpm --filter @dustnote/shared build
pnpm --filter @dustnote/server build

echo "▶ 启动 server"
SERVER_VERSION="0.1.0"
MIN_CLIENT_VERSION="0.1.0"
RECOMMENDED_CLIENT_VERSION="0.2.0"
FORCE_UPDATE_VERSION=""

cd server
SERVER_VERSION=$SERVER_VERSION \
  MIN_CLIENT_VERSION=$MIN_CLIENT_VERSION \
  RECOMMENDED_CLIENT_VERSION=$RECOMMENDED_CLIENT_VERSION \
  FORCE_UPDATE_VERSION=$FORCE_UPDATE_VERSION \
  node dist/index.js &
SERVER_PID=$!
cd ..

# 等待 ready
for i in {1..20}; do
  if curl -sf http://localhost:3210/api/v1/health > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

trap "kill $SERVER_PID 2>/dev/null" EXIT

echo ""
echo "===== 测试 1: 健康检查 ====="
curl -s http://localhost:3210/api/v1/health | head -c 300
echo ""

echo ""
echo "===== 测试 2: update-manifest（合法客户端版本）====="
curl -s -i \
  -H "X-Client-Version: 0.1.0" \
  -H "X-Client-Platform: web" \
  -H "X-Client-Channel: stable" \
  -H "X-Client-Device-Id: 11111111-1111-4111-8111-111111111111" \
  http://localhost:3210/api/v1/update-manifest | head -c 1500
echo ""

echo ""
echo "===== 测试 3: 强制升级（客户端版本过低）====="
SERVER_PID_OLD=$SERVER_PID
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

FORCE_UPDATE_VERSION="0.2.0" \
  SERVER_VERSION=$SERVER_VERSION \
  MIN_CLIENT_VERSION=$MIN_CLIENT_VERSION \
  RECOMMENDED_CLIENT_VERSION=$RECOMMENDED_CLIENT_VERSION \
  node server/dist/index.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

for i in {1..20}; do
  if curl -sf http://localhost:3210/api/v1/health > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

curl -s -i \
  -H "X-Client-Version: 0.1.0" \
  -H "X-Client-Platform: web" \
  -H "X-Client-Channel: stable" \
  -H "X-Client-Device-Id: 11111111-1111-4111-8111-111111111111" \
  http://localhost:3210/api/v1/update-manifest | head -c 1000
echo ""

echo ""
echo "✅ 所有测试完成"
