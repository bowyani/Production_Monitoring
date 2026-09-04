# Bakes the config into the image so hosts without bind mounts (Render private
# services, etc.) can run the broker. The Compose stack still mounts the file
# read-only over this copy, so editing mosquitto.conf locally needs no rebuild.
FROM eclipse-mosquitto:2
COPY config/mosquitto.conf /mosquitto/config/mosquitto.conf
EXPOSE 1883
