PLUGIN_DIR    := com.claude.usage.ulanziPlugin
INSTALL_BASE  := $(HOME)/Library/Application Support/Ulanzi/UlanziDeck/Plugins
INSTALL_DIR   := $(INSTALL_BASE)/$(PLUGIN_DIR)
DIST_DIR      := dist
ZIP           := $(DIST_DIR)/$(PLUGIN_DIR).zip

APP_NAME      := Ulanzi Studio

.PHONY: help package install restart clean

help:
	@echo "Available targets:"
	@echo "  make package  - Build a distributable ZIP at $(ZIP)"
	@echo "  make install  - Sync plugin + restart $(APP_NAME)"
	@echo "  make restart  - Restart $(APP_NAME) only"
	@echo "  make clean    - Remove $(DIST_DIR)/"

package: clean
	@echo "→ Reinstalling production deps in $(PLUGIN_DIR)..."
	@rm -rf $(PLUGIN_DIR)/node_modules
	@cd $(PLUGIN_DIR) && npm install --omit=dev --silent
	@echo "→ Pruning junk files..."
	@find $(PLUGIN_DIR) -name ".DS_Store" -delete
	@echo "→ Building $(ZIP)..."
	@mkdir -p $(DIST_DIR)
	@zip -r -q $(ZIP) $(PLUGIN_DIR) -x "*.log" -x "*/.git/*"
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
	@rsync -a --delete \
		--exclude=".DS_Store" \
		--exclude="*.log" \
		--exclude=".git" \
		$(PLUGIN_DIR)/ "$(INSTALL_DIR)/"

APP_PROC      := /Applications/$(APP_NAME).app/

restart:
	@echo "→ Restarting $(APP_NAME)..."
	@osascript -e 'tell application "$(APP_NAME)" to quit' >/dev/null 2>&1 || true
	@for i in 1 2 3 4 5; do \
		pgrep -f "$(APP_PROC)" >/dev/null 2>&1 || break; \
		sleep 1; \
	done
	@pkill -f "$(APP_PROC)" >/dev/null 2>&1 || true
	@sleep 1
	@open -a "$(APP_NAME)"

clean:
	@rm -rf $(DIST_DIR)
