#!/usr/bin/env bash
#
# 农餐馆 · 一键安装（Ubuntu 22.04 / 24.04，Debian 12 亦可）
# 用法：把整个项目拷到服务器后，在项目根目录执行
#   sudo bash deploy/install.sh
#
# 做的事：安装 Node 20 → 复制文件到 /opt/nongcanguan → 创建数据目录
#        → 注册 systemd 服务并启动 → 健康检查
#
# 注意：本脚本在 Windows 开发机上无法实测，首次部署请留意每一步输出。

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 sudo 运行：sudo bash deploy/install.sh"
  exit 1
fi

APP_DIR=/opt/nongcanguan
DATA_DIR=/var/lib/nongcanguan
SERVICE=nongcanguan
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 源目录：$SRC_DIR"

if [ ! -f "$SRC_DIR/server.js" ] || [ ! -f "$SRC_DIR/data/menu.json" ]; then
  echo "错误：看起来不是在项目根目录执行。请确认 server.js 与 data/menu.json 存在。"
  exit 1
fi

echo "==> 安装 Node.js 20"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
fi
if [ "$NODE_MAJOR" -lt 18 ]; then
  apt-get update -y
  apt-get install -y curl ca-certificates xz-utils
  if ! (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs); then
    echo "    NodeSource 安装失败，改用 npmmirror 二进制包"
    ARCH="x64"
    [ "$(uname -m)" = "aarch64" ] && ARCH="arm64"
    NODE_VER="v20.18.1"
    curl -fsSL "https://npmmirror.com/mirrors/node/${NODE_VER}/node-${NODE_VER}-linux-${ARCH}.tar.xz" -o /tmp/node.tar.xz
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
    rm -f /tmp/node.tar.xz
  fi
fi
NODE_BIN="$(command -v node)"
echo "    node: $NODE_BIN ($("$NODE_BIN" --version))"

echo "==> 复制应用文件"
mkdir -p "$APP_DIR" "$APP_DIR/data" "$DATA_DIR"
cp -f "$SRC_DIR/server.js" "$APP_DIR/server.js"
cp -f "$SRC_DIR/package.json" "$APP_DIR/package.json"
cp -f "$SRC_DIR/data/menu.json" "$APP_DIR/data/menu.json"
rm -rf "$APP_DIR/public"
cp -r "$SRC_DIR/public" "$APP_DIR/public"

id -u www-data >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin www-data
chown -R www-data:www-data "$APP_DIR" "$DATA_DIR"

echo "==> 注册 systemd 服务"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Nongcanguan CAU Food API
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/server.js
Environment=PORT=3000
Environment=DB_FILE=$DATA_DIR/db.json
Restart=always
RestartSec=3
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE"

echo "==> 健康检查"
for i in $(seq 1 10); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "    服务已启动：$(curl -fsS http://127.0.0.1:3000/api/health)"
    break
  fi
  sleep 1
done

if ! curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "服务没有起来，查看日志：journalctl -u $SERVICE -n 50 --no-pager"
  exit 1
fi

echo
echo "完成。下一步："
echo "  1. 腾讯云控制台 → 防火墙：放行 80/443（正式）或 3000（临时演示）"
echo "  2. 临时演示：浏览器访问 http://<公网IP>:3000"
echo "  3. 正式域名：配 Nginx + certbot，见 docs/小程序与服务器.md"
echo "  4. 常用命令：systemctl status $SERVICE / journalctl -u $SERVICE -f"
