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
    - 字体/字号从该列表头继承；bold 从单元格自身段落样式读取，不从表头抄
    - 填完后自动清除单元格内多余的空段落，行高改为 atLeast 避免撑出多余页
    - 如果单元格已有文字，追加而非覆盖（除非 overwrite=True）
"""

import copy
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement


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


def _apply_font(src_run, dst_run):
    """
    从 src_run 复制字体名和字号到 dst_run。
    bold/italic 等装饰属性不复制——由单元格自身段落样式决定。
    """
    if src_run.font.name:
        dst_run.font.name = src_run.font.name
        rpr = dst_run._r.get_or_add_rPr()
        rFonts = rpr.find(qn('w:rFonts'))
        if rFonts is None:
            rFonts = OxmlElement('w:rFonts')
            rpr.insert(0, rFonts)
        rFonts.set(qn('w:eastAsia'), src_run.font.name)
        rFonts.set(qn('w:ascii'), src_run.font.name)
        rFonts.set(qn('w:hAnsi'), src_run.font.name)
    if src_run.font.size:
        dst_run.font.size = src_run.font.size


def _cell_bold(cell) -> bool:
    """
    判断单元格内容是否应该加粗：
    读单元格第一段的 pStyle，再查 document styles 里该 style 的 bold 设置。
    找不到则返回 False（内容格默认不加粗）。
    """
    for para in cell.paragraphs:
        pPr = para._p.find(qn('w:pPr'))
        if pPr is not None:
            pStyle = pPr.find(qn('w:pStyle'))
            if pStyle is not None:
                style_id = pStyle.get(qn('w:val'), '')
                try:
                    style = para.part.styles.get_by_id(style_id, None)
                    if style and style.font.bold:
                        return True
                except Exception:
                    pass
        # 检查段落级别的 rPr bold
        rPr = pPr.find(qn('w:rPr')) if pPr is not None else None
        if rPr is not None:
            b = rPr.find(qn('w:b'))
            if b is not None and b.get(qn('w:val'), '1') not in ('0', 'false'):
                return True
        break  # 只看第一段
    return False


def _get_template_run(cell):
    """从单元格里找第一个有格式信息的 run 作为字体模板。"""
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


def _trim_cell_empty_paras(cell):
    """删除单元格末尾多余的空段落，只保留最后一个（Word 要求至少有一段）。"""
    paras = cell.paragraphs
    # 从后往前找第一个非空段落
    last_content = -1
    for i in range(len(paras) - 1, -1, -1):
        if paras[i].text.strip():
            last_content = i
            break
    # 删掉 last_content+1 之后的所有段落（保留最后一个空段作结尾）
    to_remove = paras[last_content + 2:]  # 保留紧跟内容后的一个空段
    for p in to_remove:
        p._element.getparent().remove(p._element)


def _set_row_height_at_least(row):
    """把行高规则改为 atLeast，让内容少时行可以自动收缩。"""
    tr = row._tr
    trPr = tr.get_or_add_trPr()
    trHeight = trPr.find(qn('w:trHeight'))
    if trHeight is not None:
        trHeight.set(qn('w:hRule'), 'atLeast')


def fill_doc(docx_path: str, fills: list, output_path: str, overwrite: bool = False):
    """
    按 fills 列表填写内容，保留原始格式，保存到 output_path。
    """
    doc = Document(docx_path)

    filled_rows: set = set()  # 记录填写过的 (table_idx, row_idx)

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

        if not overwrite and cell.text.strip():
            print(f"[跳过] 表{t_idx}[{r_idx},{c_idx}] 已有内容：{cell.text.strip()[:20]}")
            continue

        # 确定字体模板（从表头同列取字体名/字号）
        template_run = None
        if r_idx > 0:
            try:
                template_run = _get_template_run(table.rows[0].cells[c_idx])
            except Exception:
                pass
        if template_run is None:
            template_run = _get_template_run(cell)

        # 确定 bold：读单元格自身段落样式，不从表头抄
        bold = _cell_bold(cell)

        # 确定对齐
        align = _get_para_align(cell)

        # 清空单元格现有 runs（保留段落节点本身）
        for para in cell.paragraphs:
            for run in list(para.runs):
                run._r.getparent().remove(run._r)

        # 写内容
        lines = text.split("\n")
        first_para = cell.paragraphs[0] if cell.paragraphs else cell.add_paragraph()

        for line_idx, line in enumerate(lines):
            if line_idx == 0:
                para = first_para
            else:
                para = cell.add_paragraph()
                if align is not None:
                    para.alignment = align

            run = para.add_run(line)
            if template_run is not None:
                _apply_font(template_run, run)
            run.font.bold = bold

        # 清理多余空段落 + 行高设为 atLeast
        _trim_cell_empty_paras(cell)
        filled_rows.add((t_idx, r_idx))

    # 把填写过的行高改为 atLeast
    for (t_idx, r_idx) in filled_rows:
        _set_row_height_at_least(doc.tables[t_idx].rows[r_idx])

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
    import sys
    if len(sys.argv) < 2:
        print("用法: python fill_table.py <文件路径>")
        sys.exit(1)
    path = sys.argv[1]
    if path.endswith(".doc"):
        path = convert_doc(path)
        print(f"转换后路径：{path}\n")
    inspect(path)
