$env:CLAUDE_CODE_GIT_BASH_PATH = "D:\Program Files\Git\bin\bash.exe"

# Create a temporary input file with the /mcp command
$tempInput = "D:\Work\00.개발\클로드아티팩트\mcp_input.txt"
"/mcp" | Out-File -FilePath $tempInput -Encoding UTF8

# Run claude --debug with the input file
Get-Content $tempInput | claude --debug

# Clean up
Remove-Item $tempInput -ErrorAction SilentlyContinue