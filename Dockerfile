# PocketBase Dockerfile
# Coolify deployment için

FROM ghcr.io/muchobien/pocketbase:latest

# pb_hooks kopyala
COPY pb_hooks /pb_hooks

# Port
EXPOSE 8090

# Başlat
CMD ["serve", "--http=0.0.0.0:8090", "--hooksDir=/pb_hooks"]
