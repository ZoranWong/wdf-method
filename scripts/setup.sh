#!/bin/bash
# web-dev-flow — One-Command Setup
# Installs skill, configures permissions, and initializes project.
#
# Usage:
#   bash scripts/setup.sh              # Interactive setup
#   bash scripts/setup.sh --init       # Also initialize status/ directory
#   bash scripts/setup.sh --dry-run    # Preview what would happen
#   bash scripts/setup.sh --uninstall  # Remove all installed files

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;37m'
BOLD='\033[1m'
NC='\033[0m'

UNINSTALL=false
INIT=false
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --init)         INIT=true ;;
    --dry-run)      DRY_RUN=true ;;
    --uninstall)    UNINSTALL=true ;;
    -h|--help)
      echo "Usage: bash scripts/setup.sh [options]"
      echo ""
      echo "Options:"
      echo "  --init         Also initialize project structure"
      echo "  --dry-run      Preview steps without making changes"
      echo "  --uninstall    Remove all installed files"
      echo "  -h, --help     Show this help"
      exit 0
      ;;
  esac
done

# ── Resolve skill directory ──────────────────────────────────────────────────
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"

# ── Uninstall ─────────────────────────────────────────────────────────────────
if [ "$UNINSTALL" = true ]; then
  echo -e "${RED}${BOLD}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}${BOLD}║   web-dev-flow — Uninstall                   ║${NC}"
  echo -e "${RED}${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  # Remove symlink
  if [ -L "$CLAUDE_SKILLS_DIR/web-dev-flow" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo -e "  ${GRAY}[DRY RUN] Would remove symlink: $CLAUDE_SKILLS_DIR/web-dev-flow${NC}"
    else
      rm "$CLAUDE_SKILLS_DIR/web-dev-flow"
      echo -e "  ${GREEN}✓${NC} Removed Claude Code skill symlink"
    fi
  else
    echo -e "  ${GRAY}-${NC} No skill symlink found${NC}"
  fi

  echo ""
  echo -e "  ${GRAY}Note: Project output directories (.claude/worktrees/, _bmad-output/) are NOT removed.${NC}"
  echo ""
  exit 0
fi

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}║   web-dev-flow V3.6 — Setup                  ║${NC}"
echo -e "${BLUE}${BOLD}║   AI-Assisted Web Development Workflow        ║${NC}"
echo -e "${BLUE}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}[DRY RUN] No changes will be made.${NC}"
  echo ""
fi

# ── Step 1: Install Claude Code skill ────────────────────────────────────────
echo -e "${BOLD}Step 1: Install Claude Code Skill${NC}"
echo ""

if [ -L "$CLAUDE_SKILLS_DIR/web-dev-flow" ]; then
  TARGET=$(readlink -f "$CLAUDE_SKILLS_DIR/web-dev-flow" 2>/dev/null || echo "unknown")
  echo -e "  ${GREEN}✓${NC} Skill already installed"
  echo -e "  ${GRAY}  Symlink → $TARGET${NC}"
else
  if [ "$DRY_RUN" = true ]; then
    echo -e "  ${GRAY}[DRY RUN] Would create symlink:${NC}"
    echo -e "  ${GRAY}  $CLAUDE_SKILLS_DIR/web-dev-flow → $SKILL_DIR${NC}"
  else
    ln -sf "$SKILL_DIR" "$CLAUDE_SKILLS_DIR/web-dev-flow"
    echo -e "  ${GREEN}✓${NC} Skill installed as Claude Code skill"
    echo -e "  ${GRAY}  $CLAUDE_SKILLS_DIR/web-dev-flow → $SKILL_DIR${NC}"
  fi
fi

echo ""

# ── Step 2: Configure permissions ────────────────────────────────────────────
echo -e "${BOLD}Step 2: Configure Sub-Agent Permissions${NC}"
echo ""

SETTINGS_FILE="$SKILL_DIR/.claude/settings.json"
if [ -f "$SETTINGS_FILE" ]; then
  echo -e "  ${GREEN}✓${NC} Permissions configured in .claude/settings.json"
  echo -e "  ${GRAY}  Tools: Read, Write, Bash, Grep, Glob, Edit, Agent, Task${NC}"
else
  echo -e "  ${YELLOW}⚠ No .claude/settings.json found in skill directory.${NC}"
  echo -e "  ${GRAY}  Sub-agents will need manual permission for Write + Bash.${NC}"
fi

echo ""

# ── Step 3: Create shared signal directory ───────────────────────────────────
echo -e "${BOLD}Step 3: Agent Communication Directory${NC}"
echo ""

SIGNAL_DIR="/tmp/web-dev-flow/signals"
if [ -d "$SIGNAL_DIR" ]; then
  echo -e "  ${GREEN}✓${NC} Signal directory exists: $SIGNAL_DIR"
else
  if [ "$DRY_RUN" = true ]; then
    echo -e "  ${GRAY}[DRY RUN] Would create: $SIGNAL_DIR${NC}"
  else
    mkdir -p "$SIGNAL_DIR/agents"
    echo -e "  ${GREEN}✓${NC} Signal directory created: $SIGNAL_DIR"
  fi
fi

echo ""

# ── Step 4: Optional project initialization ──────────────────────────────────
if [ "$INIT" = true ]; then
  echo -e "${BOLD}Step 4: Initialize Project Structure${NC}"
  echo ""

  OUTPUT_DIR="$SKILL_DIR/_bmad-output/web-dev-flow"
  if [ "$DRY_RUN" = true ]; then
    echo -e "  ${GRAY}[DRY RUN] Would create:${NC}"
    echo -e "  ${GRAY}  $OUTPUT_DIR/_output/{planning,solutioning,acceptance}${NC}"
    echo -e "  ${GRAY}  $OUTPUT_DIR/status/{global,phase-01,phase-02,phase-03,phase-04-be,phase-04-fe,change-requests}${NC}"
    echo -e "  ${GRAY}  $OUTPUT_DIR/status/merge-queue/queue.yaml${NC}"
    echo -e "  ${GRAY}  $OUTPUT_DIR/stories/${NC}"
  else
    mkdir -p "$OUTPUT_DIR/_output/planning"
    mkdir -p "$OUTPUT_DIR/_output/solutioning"
    mkdir -p "$OUTPUT_DIR/_output/acceptance"
    mkdir -p "$OUTPUT_DIR/status/merge-queue/items"
    mkdir -p "$OUTPUT_DIR/status/stories"
    echo -e "  ${GREEN}✓${NC} Output directories created"
    echo -e "  ${GRAY}  $OUTPUT_DIR${NC}"
  fi
  echo ""
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
echo ""

echo -e "${BOLD}What's configured:${NC}"
echo -e "  ${GREEN}✓${NC} Claude Code skill — use /web-dev-flow to start"
echo -e "  ${GREEN}✓${NC} Agent communication — /tmp/web-dev-flow/signals/"
if [ -f "$SETTINGS_FILE" ]; then
  echo -e "  ${GREEN}✓${NC} Sub-agent permissions — Read Write Bash Grep Glob Edit Agent Task"
fi
echo ""

echo -e "${BOLD}Available commands:${NC}"
echo ""
echo -e "  ${YELLOW}/web-dev-flow init${NC}              — Initialize a new project"
echo -e "  ${YELLOW}/web-dev-flow status${NC}            — Show progress dashboard"
echo -e "  ${YELLOW}/web-dev-flow start${NC}             — Start/resume current phase"
echo -e "  ${YELLOW}/web-dev-flow pause${NC}             — Pause and save state"
echo -e "  ${YELLOW}/web-dev-flow resume${NC}            — Resume from pause"
echo -e "  ${YELLOW}/web-dev-flow freeze requirements${NC} — Freeze requirements"
echo -e "  ${YELLOW}/web-dev-flow accept code${NC}       — Run CODE ACCEPTANCE"
echo -e "  ${YELLOW}/web-dev-flow queue show${NC}        — Show merge queue"
echo -e "  ${YELLOW}/web-dev-flow rebuild-status${NC}    — Rebuild status index"
echo ""

echo -e "${GRAY}Full guide: cat SETUP.md${NC}"
echo ""
