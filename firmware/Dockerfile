# One image that builds every Keyzforge firmware target:
#   docker build -t keyforge-fw firmware
#   docker run --rm -v "$PWD:/src" -w /src keyforge-fw firmware/build.sh pico pico2 esp32s3 esp32s2
FROM espressif/idf:v5.5.1

RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake gcc-arm-none-eabi libnewlib-arm-none-eabi \
      libstdc++-arm-none-eabi-newlib build-essential libusb-1.0-0-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

ENV PICO_SDK_PATH=/opt/pico-sdk
RUN git clone --depth 1 --branch 2.1.1 https://github.com/raspberrypi/pico-sdk "$PICO_SDK_PATH" \
 && git -C "$PICO_SDK_PATH" submodule update --init --depth 1 \
 && git clone --depth 1 --branch 2.1.1 https://github.com/raspberrypi/picotool /tmp/picotool \
 && cmake -S /tmp/picotool -B /tmp/picotool/build -DPICO_SDK_PATH="$PICO_SDK_PATH" \
 && cmake --build /tmp/picotool/build -j"$(nproc)" \
 && cmake --install /tmp/picotool/build \
 && rm -rf /tmp/picotool

RUN git config --global --add safe.directory '*'
