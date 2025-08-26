import os

target_folder = r"D:\Work\00.개발\클로드아티팩트\동영상워터마크지우기\Realwatermarkdelete"

print "Current folder:", os.getcwd()
print "Target folder:", target_folder
print "Folder exists:", os.path.exists(target_folder)

if os.path.exists(target_folder):
    files = os.listdir(target_folder)
    print "Total files:", len(files)
    
    for f in files:
        if f.endswith('.mp4'):
            print "MP4 found:", f
            full_path = os.path.join(target_folder, f)
            print "Full path:", full_path
            print "File exists:", os.path.exists(full_path)
            print "File size:", os.path.getsize(full_path), "bytes"