"""Convert FDA Data Dashboard xlsx exports to CSV (streaming, openpyxl read_only).
Usage: python -I scripts/03_xlsx_to_csv.py in.xlsx out.csv"""
import sys, csv, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb.worksheets[0]
n = 0
with open(sys.argv[2], 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh)
    for row in ws.iter_rows(values_only=True):
        w.writerow(['' if v is None else (v.isoformat()[:10] if hasattr(v, 'isoformat') else v) for v in row]); n += 1
print(sys.argv[1], 'sheets', wb.sheetnames, 'rows', n)
