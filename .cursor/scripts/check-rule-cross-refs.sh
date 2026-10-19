#!/usr/bin/env bash
# 规则交叉引用检查：叶子规则正文禁止引用其他 .mdc 文件，仅路由层白名单可引用。
# 退出码 0 = 通过；1 = 发现违规；2 = 目录缺失。检查口径以 .cursor/rules/cross-ref-guard.mdc 为准。
set -euo pipefail

RULES_DIR="${1:-.cursor/rules}"

# 路由层白名单：允许在正文引用其他 .mdc 路径（仅限映射表 / 流程说明）
WHITELIST="rules-loader.mdc correction-detection.mdc cross-ref-guard.mdc java-edit-self-check.mdc"

if [ ! -d "$RULES_DIR" ]; then
  echo "规则目录不存在: $RULES_DIR" >&2
  exit 2
fi

violations=0

while IFS= read -r -d '' file; do
  base="$(basename "$file")"
  case " $WHITELIST " in
    *" $base "*) continue ;;
  esac

  while IFS=: read -r lineno text; do
    [ -z "${lineno:-}" ] && continue
    refs="$(printf '%s\n' "$text" | grep -oE '[A-Za-z0-9_-]+\.mdc' || true)"
    for ref in $refs; do
      if [ "$ref" != "$base" ]; then  # 忽略自引用
        echo "  $file:$lineno  ->  $ref"
        echo "      $(printf '%s' "$text" | sed 's/^[[:space:]]*//')"
        violations=$((violations + 1))
      fi
    done
  done < <(grep -nE '[A-Za-z0-9_-]+\.mdc' "$file" || true)
done < <(find "$RULES_DIR" -name '.*' -prune -o -type f -name '*.mdc' -print0)

if [ "$violations" -gt 0 ]; then
  echo "✗ 规则交叉引用检查未通过，发现 $violations 处叶子规则跨文件引用。"
  echo "处理：移除叶子规则正文中的 .mdc 引用，改在 rules-loader.mdc 场景表并列加载，或就地内联必要条文。"
  exit 1
fi

echo "✓ 规则交叉引用检查通过：叶子规则无跨文件 .mdc 引用。"
exit 0
