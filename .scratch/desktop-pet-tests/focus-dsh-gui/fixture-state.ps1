param(
  [string]$TabNeedle = 'probe-7',
  [int]$ProcId = 0,
  [switch]$ActivateOther
)
# Fixture window state reader (diagnostics only). With -ActivateOther it selects
# the first non-target tab, i.e. reproduces "user switched to another tab".
# NOTE: keep this file ASCII-only -- Windows PowerShell 5.1 reads .ps1 without
# BOM using the ANSI code page and mangles non-ASCII comments.
Add-Type -AssemblyName 'UIAutomationClient, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35' -ErrorAction Stop
Add-Type -AssemblyName 'UIAutomationTypes, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35' -ErrorAction Stop
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W32s {
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wcond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$tabCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)

function Get-Tabs($w) {
  $out = @()
  $tabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
  foreach ($t in $tabs) {
    $pat = [System.Windows.Automation.SelectionItemPattern]$t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $out += [pscustomobject]@{ Element = $t; Pattern = $pat; Name = $t.Current.Name; Selected = $pat.Current.IsSelected }
  }
  return ,$out
}

$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $wcond)
$found = $false
foreach ($w in $wins) {
  if ($w.Current.NativeWindowHandle -eq 0) { continue }
  $pid2 = $w.Current.ProcessId
  if ($ProcId -gt 0 -and $pid2 -ne $ProcId) { continue }
  try { $img = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).Path } catch { $img = '' }
  if ((Split-Path $img -Leaf) -notin @('chrome.exe', 'msedge.exe', 'firefox.exe')) { continue }
  $tabs = Get-Tabs $w
  $hasTarget = $false
  foreach ($t in $tabs) { if ($t.Name -like "*$TabNeedle*") { $hasTarget = $true } }
  if (-not $hasTarget) { continue }
  $found = $true
  $hwnd = [IntPtr]$w.Current.NativeWindowHandle
  if ($ActivateOther) {
    $other = $tabs | Where-Object { $_.Name -notlike "*$TabNeedle*" } | Select-Object -First 1
    if ($other) { $other.Pattern.Select(); Start-Sleep -Milliseconds 400; $tabs = Get-Tabs $w }
  }
  $sel = $tabs | Where-Object { $_.Selected } | Select-Object -First 1
  $selIsTarget = ($sel -and ($sel.Name -like "*$TabNeedle*"))
  Write-Output ("FOUND=True PID={0} HWND={1} TABS={2}" -f $pid2, $hwnd, $tabs.Count)
  Write-Output ("TARGET_SELECTED={0}" -f ([bool]$selIsTarget))
  Write-Output ("WINDOW_MINIMIZED={0}" -f [W32s]::IsIconic($hwnd))
  Write-Output ("IS_FOREGROUND={0}" -f ([W32s]::GetForegroundWindow() -eq $hwnd))
}
if (-not $found) { Write-Output 'FOUND=False' }
