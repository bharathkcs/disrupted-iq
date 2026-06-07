$input = $env:CLAUDE_TOOL_INPUT | ConvertFrom-Json
$cmd = $input.command

$blocked = @(
    'format ',
    'del /f /s',
    'rd /s /q',
    'wget.*\|.*sh',
    'curl.*\|.*sh',
    'chmod 777',
    'dd if='
)

foreach ($pattern in $blocked) {
    if ($cmd -match $pattern) {
        Write-Error "Blocked: command matches dangerous pattern '$pattern'"
        exit 1
    }
}
exit 0
