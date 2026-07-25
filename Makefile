PLUGIN_DIR    := com.claude.usage.ulanziPlugin
DIST_DIR      := dist
ZIP           := $(DIST_DIR)/$(PLUGIN_DIR).zip

APP_NAME      := Ulanzi Studio

# The plugins folder lives in a different place per OS. On Windows these targets
# expect a POSIX shell (Git Bash / MSYS2), which is what `make` runs under there.
ifeq ($(OS),Windows_NT)
INSTALL_BASE  := $(subst \,/,$(APPDATA))/Ulanzi/UlanziDeck/Plugins
else
INSTALL_BASE  := $(HOME)/Library/Application Support/Ulanzi/UlanziDeck/Plugins
endif
INSTALL_DIR   := $(INSTALL_BASE)/$(PLUGIN_DIR)

.PHONY: help package install sync restart clean bump_major bump_minor bump_patch

help:
	@echo "Available targets:"
	@echo "  make package     - Build a distributable ZIP at $(ZIP)"
	@echo "  make install     - Sync plugin + restart $(APP_NAME)"
	@echo "  make restart     - Restart $(APP_NAME) only"
	@echo "  make clean       - Remove $(DIST_DIR)/"
	@echo "  make bump_major  - Bump major version (1.0.0 → 2.0.0)"
	@echo "  make bump_minor  - Bump minor version (1.0.0 → 1.1.0)"
	@echo "  make bump_patch  - Bump patch version (1.0.0 → 1.0.1)"

bump_major bump_minor bump_patch:
	@TYPE=$(subst bump_,,$@); \
	cd $(PLUGIN_DIR) && npm version $$TYPE --no-git-tag-version --silent; \
	NEW_VER=$$(node -p "require('./package.json').version"); \
	node -e " \
		const fs = require('fs'); \
		const f = 'manifest.json'; \
		const m = JSON.parse(fs.readFileSync(f)); \
		m.Version = '$$NEW_VER'; \
		fs.writeFileSync(f, JSON.stringify(m, null, 2) + '\n'); \
	"; \
	echo "✓ Version bumped to $$NEW_VER (package.json + manifest.json)"

package: clean
	@echo "→ Reinstalling production deps in $(PLUGIN_DIR)..."
	@rm -rf $(PLUGIN_DIR)/node_modules
	@cd $(PLUGIN_DIR) && npm install --omit=dev --silent
	@echo "→ Pruning junk files..."
	@find $(PLUGIN_DIR) -name ".DS_Store" -delete
	@echo "→ Building $(ZIP)..."
	@mkdir -p $(DIST_DIR)
ifeq ($(OS),Windows_NT)
	@powershell -NoProfile -Command "Compress-Archive -Path '$(PLUGIN_DIR)' -DestinationPath '$(ZIP)' -Force"
else
	@zip -r -q $(ZIP) $(PLUGIN_DIR) -x "*.log" -x "*/.git/*"
endif
	@echo "✓ $(ZIP) ($$(du -h $(ZIP) | cut -f1))"

install: sync restart
	@echo "✓ Installed and restarted."

sync:
	@if [ ! -d $(PLUGIN_DIR)/node_modules ]; then \
		echo "→ Installing deps..."; \
		cd $(PLUGIN_DIR) && npm install --omit=dev --silent; \
	fi
	@echo "→ Syncing to $(INSTALL_DIR)..."
	@mkdir -p "$(INSTALL_BASE)"
ifeq ($(OS),Windows_NT)
	@rm -rf "$(INSTALL_DIR)"
	@mkdir -p "$(INSTALL_DIR)"
	@cp -R $(PLUGIN_DIR)/. "$(INSTALL_DIR)/"
	@rm -rf "$(INSTALL_DIR)/.git"
	@find "$(INSTALL_DIR)" -name "*.log" -delete
else
	@rsync -a --delete \
		--exclude=".DS_Store" \
		--exclude="*.log" \
		--exclude=".git" \
		$(PLUGIN_DIR)/ "$(INSTALL_DIR)/"
endif

APP_PROC      := /Applications/$(APP_NAME).app/

restart:
	@echo "→ Restarting $(APP_NAME)..."
ifeq ($(OS),Windows_NT)
	@# Read the running executable's path before killing it, so the relaunch
	@# works regardless of where the user installed Ulanzi Studio.
	@powershell -NoProfile -Command " \
		$$p = Get-Process -Name 'UlanziStudio','Ulanzi Studio','UlanziDeck' -ErrorAction SilentlyContinue | Select-Object -First 1; \
		$$exe = $$p.Path; \
		if ($$p) { Stop-Process -Id $$p.Id -Force; Start-Sleep -Seconds 2 } ; \
		if ($$exe) { Start-Process $$exe } else { Write-Host 'Ulanzi Studio not running — start it manually to load the plugin.' }"
else
	@osascript -e 'tell application "$(APP_NAME)" to quit' >/dev/null 2>&1 || true
	@for i in 1 2 3 4 5; do \
		pgrep -f "$(APP_PROC)" >/dev/null 2>&1 || break; \
		sleep 1; \
	done
	@pkill -f "$(APP_PROC)" >/dev/null 2>&1 || true
	@sleep 1
	@open -a "$(APP_NAME)"
endif

clean:
	@rm -rf $(DIST_DIR)
