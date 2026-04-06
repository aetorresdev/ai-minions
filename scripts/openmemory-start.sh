#!/usr/bin/env bash
# openmemory-start.sh — levanta el stack de OpenMemory (Qdrant + MCP server)
set -e

COMPOSE_DIR="$HOME/openmemory/openmemory"

if ! docker info > /dev/null 2>&1; then
  echo "Docker no está corriendo." >&2
  exit 1
fi

cd "$COMPOSE_DIR"
docker-compose up -d mem0_store openmemory-mcp

# Espera hasta que el API responda (max 15s)
for i in $(seq 1 15); do
  if curl -sf --max-time 1 "http://localhost:8765/api/v1/memories/" \
       -G --data-urlencode "user_id=andres" > /dev/null 2>&1; then
    echo "OpenMemory listo en http://localhost:8765"
    exit 0
  fi
  sleep 1
done

echo "OpenMemory tardó más de lo esperado — revisa: docker logs openmemory_openmemory-mcp_1" >&2
exit 1
