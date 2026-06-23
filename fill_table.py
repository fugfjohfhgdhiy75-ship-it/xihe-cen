"""
fill_table.py
用法：
  1. 把 .doc 文件路径传给 convert_doc()，得到 .docx 路径
  2. 把 .docx 路径和填写内容传给 fill_doc()，得到填好的文件

fill_doc(docx_path, fills, output_path)
  fills 是一个列表，每项是：
    {
      "table": 0,          # 第几张表（从0数）
      "row":   1,          # 第几行（从0数）
      "col":   1,          # 第几列（从0数）
      "text":  "内容...",  # 要填的文字（用 \n 换行）
    }
  规则：
    - 只往空单元格里写文字
    - 字体/字号/对齐全部从该单元格的第一段继承，不新建任何样式
    - 如果单元格已有文字，追加而非覆盖（除非 overwrite=True）
"""

import shutil
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
import copy


def convert_doc(doc_path: str, out_dir: str = None) -> str:
    """
    把 .doc 转成 .docx，返回 .docx 路径。
    需要 spire.doc 已安装（pip install spire.doc）。
    如果已经是 .docx，直接返回原路径。
    """
    src = Path(doc_path)
    if src.suffix.lower() == ".docx":
        return str(src)

    from spire.doc import Document as SpireDoc, FileFormat
    out_dir = Path(out_dir) if out_dir else src.parent
    out_path = out_dir / (src.stem + "_converted.docx")

    d = SpireDoc()
    d.LoadFromFile(str(src))
    d.SaveToFile(str(out_path), FileFormat.Docx2019)
    return str(out_path)


def _copy_run_format(src_run, dst_run):
    """把 src_run 的 rPr 节点克隆到 dst_run，保留所有字体/字号/颜色属性。"""
    src_rpr = src_run._r.get_or_add_rPr()
    dst_rpr = dst_run._r.get_or_add_rPr()
    # 复制每个子节点
    for child in list(dst_rpr):
        dst_rpr.remove(child)
    for child in src_rpr:
        dst_rpr.append(copy.deepcopy(child))


def _get_template_run(cell):
    """
    从单元格里找到第一个有格式信息的 run 作为模板。
    找不到就返回 None。
    """
    for para in cell.paragraphs:
        for run in para.runs:
            if run._r.get_or_add_rPr() is not None:
                return run
    return None


def _get_para_align(cell):
    """取单元格第一段的对齐方式。"""
    for para in cell.paragraphs:
        return para.alignment
    return None


def fill_doc(docx_path: str, fills: list, output_path: str, overwrite: bool = False):
    """
    按 fills 列表填写内容，保留所有原始格式，保存到 output_path。
    """
    doc = Document(docx_path)

    for item in fills:
        t_idx = item["table"]
        r_idx = item["row"]
        c_idx = item["col"]
        text  = item["text"]

        if t_idx >= len(doc.tables):
            print(f"[警告] 第 {t_idx} 张表不存在，跳过")
            continue

        table = doc.tables[t_idx]

        if r_idx >= len(table.rows):
            print(f"[警告] 表{t_idx} 第 {r_idx} 行不存在，跳过")
            continue

        row = table.rows[r_idx]

        if c_idx >= len(row.cells):
            print(f"[警告] 表{t_idx}行{r_idx} 第 {c_idx} 列不存在，跳过")
            continue

        cell = row.cells[c_idx]

        # 如果不覆盖且已有文字，跳过
        if not overwrite and cell.text.strip():
            print(f"[跳过] 表{t_idx}[{r_idx},{c_idx}] 已有内容：{cell.text.strip()[:20]}")
            continue

        # 找模板 run（从表头同列找，或从本单元格找）
        template_run = None
        if r_idx > 0:
            # 优先从同列第0行取格式模板
            try:
                template_run = _get_template_run(table.rows[0].cells[c_idx])
            except Exception:
                pass
        if template_run is None:
            template_run = _get_template_run(cell)

        # 清空单元格现有段落内容（保留段落本身的格式）
        for para in cell.paragraphs:
            for run in list(para.runs):
                run._r.getparent().remove(run._r)

        # 按 \n 拆行，第一行写进第一段，后续行新增段落
        lines = text.split("\n")
        first_para = cell.paragraphs[0] if cell.paragraphs else cell.add_paragraph()
        align = _get_para_align(cell)

        for line_idx, line in enumerate(lines):
            if line_idx == 0:
                para = first_para
            else:
                para = cell.add_paragraph()
                if align is not None:
                    para.alignment = align

            run = para.add_run(line)
            if template_run is not None:
                _copy_run_format(template_run, run)
            run.font.bold = False  # 填写内容一律不加粗

    doc.save(output_path)
    print(f"[完成] 已保存到 {output_path}")


# ──────────────────────────────────────────────
# 快捷函数：打印文件里所有表格结构，方便确认行列编号
# ──────────────────────────────────────────────
def inspect(docx_path: str):
    doc = Document(docx_path)
    print(f"共 {len(doc.tables)} 张表\n")
    for ti, table in enumerate(doc.tables):
        print(f"=== 表 {ti} ：{len(table.rows)} 行 × {len(table.columns)} 列 ===")
        for ri, row in enumerate(table.rows):
            for ci, cell in enumerate(row.cells):
                txt = cell.text.strip().replace("\n", "|")[:30]
                print(f"  [{ri},{ci}] {txt!r}")
        print()


if __name__ == "__main__":
    # 示例：直接运行时打印结构
    import sys
    if len(sys.argv) < 2:
        print("用法: python fill_table.py <文件路径>")
        sys.exit(1)
    path = sys.argv[1]
    if path.endswith(".doc"):
        path = convert_doc(path)
        print(f"转换后路径：{path}\n")
    inspect(path)
