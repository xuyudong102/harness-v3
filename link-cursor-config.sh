#!/usr/bin/env bash
#
# 将 Harness Cursor 配置链接到目标业务项目。
#
# 集合链接: .cursor、docs（逐项软链子项，含 docs/templates）
# 本地目录: docs/artifacts/work, docs/artifacts/archive
#
# 用法:
#   ./link-cursor-config.sh <目标项目路径>
#   bash link-cursor-config.sh <目标项目路径>
#   ./link-cursor-config.sh -f <目标项目路径>
#
# 示例:
#   ./link-cursor-config.sh ~/Work/Project/Java/broker
#   ./link-cursor-config.sh -f ~/Work/Project/Java/broker

set -euo pipefail

ensure_harness_script_permissions() {
    local root="$1"
    local script
    local rel
    local fixed=0

    for script in "$root/link-cursor-config.sh" "$root"/.cursor/scripts/*.sh; do
        [[ -f "$script" ]] || continue
        if [[ ! -x "$script" ]]; then
            chmod +x "$script"
            rel="${script#"$root"/}"
            echo "  [OK]   设置可执行: $rel"
            fixed=$((fixed + 1))
        fi
    done

    if [[ "$fixed" -gt 0 ]]; then
        echo "  已为 $fixed 个 shell 脚本补全可执行权限（macOS/Linux git clone 常见丢失 +x）"
    fi
}

SOURCE_EARLY="$(cd "$(dirname "$0")" && pwd)"
ensure_harness_script_permissions "$SOURCE_EARLY"

FORCE=false
if [[ "${1:-}" == "-f" ]]; then
    FORCE=true
    shift
fi

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
    echo "用法: $0 [-f] <目标项目路径>"
    exit 1
fi

SOURCE="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -d "$SOURCE" ]]; then
    echo "错误: 源目录不存在: $SOURCE" >&2
    exit 1
fi
if [[ ! -d "$TARGET" ]]; then
    echo "错误: 目标目录不存在: $TARGET" >&2
    exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"

if [[ "$TARGET" == "$SOURCE" ]]; then
    echo "错误: 目标目录不能是 Harness 源目录本身" >&2
    exit 1
fi
case "$TARGET/" in
    "$SOURCE/"*)
        echo "错误: 目标目录不能位于 Harness 源目录内部，避免产生循环链接: $TARGET" >&2
        exit 1
        ;;
esac

COLLECTIONS=(
    ".cursor"
    "docs"
)

LOCAL_DIRS=(
    "docs/artifacts/work"
    "docs/artifacts/archive"
)

success=0
skip=0
fail=0

is_excluded() {
    local collection="$1"
    local name="$2"

    [[ "$name" == ".DS_Store" ]] && return 0
    if [[ "$collection" == "docs" && "$name" == "artifacts" ]]; then
        return 0
    fi
    return 1
}

remove_existing() {
    local dst_path="$1"
    if [[ ! -e "$dst_path" && ! -L "$dst_path" ]]; then
        return 0
    fi
    if $FORCE; then
        rm -rf "$dst_path"
        echo "  移除已有项: $dst_path"
        return 0
    fi
    return 1
}

ensure_collection_directory() {
    local rel="$1"
    local dst_dir="$TARGET/$rel"

    mkdir -p "$(dirname "$dst_dir")"

    if [[ -L "$dst_dir" ]]; then
        if ! remove_existing "$dst_dir"; then
            echo "  [SKIP] $rel — 集合目录已是链接（使用 -f 覆盖）" >&2
            return 1
        fi
    fi

    if [[ ! -d "$dst_dir" ]]; then
        mkdir -p "$dst_dir"
    fi
    return 0
}

link_collection_entry() {
    local rel="$1"
    local src_path="$2"
    local dst_path="$3"

    if [[ ! -e "$src_path" ]]; then
        echo "  [SKIP] $rel — 源不存在"
        ((++skip))
        return
    fi

    mkdir -p "$(dirname "$dst_path")"

    if [[ -e "$dst_path" || -L "$dst_path" ]]; then
        if ! remove_existing "$dst_path"; then
            echo "  [SKIP] $rel — 已存在（使用 -f 覆盖）"
            ((++skip))
            return
        fi
    fi

    if ln -s "$src_path" "$dst_path" 2>/dev/null; then
        echo "  [OK]   $rel (symlink)"
        echo "         $src_path -> $dst_path"
        ((++success))
    else
        echo "  [FAIL] $rel" >&2
        ((++fail))
    fi
}

echo ""
echo "=== 链接集合 ==="
for collection in "${COLLECTIONS[@]}"; do
    src_dir="$SOURCE/$collection"

    if [[ ! -d "$src_dir" ]]; then
        echo "  [SKIP] $collection — 源集合不存在"
        ((++skip))
        continue
    fi

    if ! ensure_collection_directory "$collection"; then
        ((++skip))
        continue
    fi

    echo "  -> $collection"

    shopt -s dotglob nullglob
    for entry in "$src_dir"/*; do
        name="$(basename "$entry")"
        if is_excluded "$collection" "$name"; then
            echo "     [SKIP] docs/artifacts — 使用目标项目本地目录"
            continue
        fi

        rel="$collection/$name"
        dst_path="$TARGET/$rel"
        link_collection_entry "$rel" "$entry" "$dst_path"
    done
    shopt -u dotglob nullglob
done

# B2C's formal multi-repo root has no enclosing project instructions on a fresh install.
# Never overwrite an existing (including symlinked) project AGENTS, even with -f.
if [[ "$TARGET" == */repos/b2c/backend && ! -e "$TARGET/AGENTS.md" && ! -L "$TARGET/AGENTS.md" ]]; then
    node --input-type=module - "$TARGET/AGENTS.md" <<'NODE'
import fs from 'node:fs';
fs.writeFileSync(process.argv[2], `# B2C Backend Workspace

<!-- Created by Harness link-cursor-config.sh; project-owned instructions, not host bootstrap. -->
本目录是 B2C 后端多仓工作区。Git 操作进入拥有 .git 的子仓库。
项目规则作用域为 b2cmall，按任务读取 .cursor/rules/projects/b2cmall/；不加载 Broker/Yunshang 项目规则。
.cursor 通过正式链接指向 Harness 规范源，不复制 Rule/Skill 正文。宿主 Harness bootstrap 不在本文件重复维护。
当前环境事实按需读取既有 Local Environment Profile；字段缺失时保持未知，不回退其他平台。
`, { flag: 'wx' });
NODE
    echo "  [OK]   AGENTS.md — 创建 B2C 根目录最小项目上下文"
    ((++success))
fi

echo ""
echo "=== 初始化目标项目本地目录 ==="
for rel in "${LOCAL_DIRS[@]}"; do
    dst_path="$TARGET/$rel"
    if [[ ! -d "$dst_path" ]]; then
        mkdir -p "$dst_path"
        echo "  [OK]   $rel (local, 目标项目独立目录)"
        ((++success))
    else
        echo "  [OK]   $rel (local, 已存在)"
    fi
done

echo ""
echo "完成: 成功 $success, 跳过 $skip, 失败 $fail"

echo ""
echo "  [提示] MCP 配置"
echo "    在 Cursor Settings → MCP 中按需启用服务"

echo ""
echo "  [提示] 可选：CodeGraph 索引（在业务项目根）"
echo "    cd \"$TARGET\" && codegraph init -i ."

echo ""
ensure_harness_script_permissions "$SOURCE"

if [[ $fail -gt 0 ]]; then
    exit 1
fi
