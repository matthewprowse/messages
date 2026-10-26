# Konva Relay. On the Mac: make install, then make setup, then make agent. See README.md.

APP_NAME = Konva Relay.app
BUILT = .build/$(APP_NAME)
INSTALLED = $(HOME)/Applications/$(APP_NAME)
RELAY = "$(INSTALLED)/Contents/MacOS/konva-relay"

.PHONY: build app install setup agent status uninstall test

build:
	swift build -c release

# A real app bundle, ad hoc signed, so macOS asks for Reminders access as Konva Relay rather than as Terminal.
app: build
	rm -rf "$(BUILT)"
	mkdir -p "$(BUILT)/Contents/MacOS"
	cp "$$(swift build -c release --show-bin-path)/konva-relay" "$(BUILT)/Contents/MacOS/konva-relay"
	cp Info.plist "$(BUILT)/Contents/Info.plist"
	codesign --force --sign - --identifier app.konva.relay "$(BUILT)"

install: app
	mkdir -p "$(HOME)/Applications"
	rm -rf "$(INSTALLED)"
	cp -R "$(BUILT)" "$(INSTALLED)"
	@# A running agent picks up the new copy.
	-@launchctl kickstart -k gui/$$(id -u)/app.konva.relay 2>/dev/null
	@echo "Installed in ~/Applications. Next: make setup"

setup:
	$(RELAY) setup

agent:
	$(RELAY) install-agent

status:
	$(RELAY) status

uninstall:
	-$(RELAY) forget
	rm -rf "$(INSTALLED)"

test:
	swift test
