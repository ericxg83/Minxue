# 9A U3 AB Test - Full random shuffle (no adjacent same)
$rng = New-Object System.Random(20260819)

$part1_words = @('essential','wherever','passport','adapter','mobile','charger','pack','worth','stall','empty','stomach','persuade')
$part1 = @()
for ($i = 0; $i -lt 12; $i++) {
  $part1 += "$i" + "_0"
  $part1 += "$i" + "_1"
}
$max = 2000
$attempts = 0
while ($attempts -lt $max) {
  $shuffled = $part1 | Sort-Object { $rng.Next() }
  $ok = $true
  for ($k = 0; $k -lt ($shuffled.Count - 1); $k++) {
    $a = ($shuffled[$k] -split "_")[0]
    $b = ($shuffled[$k+1] -split "_")[0]
    if ($a -eq $b) { $ok = $false; break }
  }
  if ($ok) { $part1 = $shuffled; break }
  $attempts++
}
Write-Host "Part I (attempts=$attempts):"
$j = 0
while ($j -lt 24) {
  $bits = $part1[$j] -split "_"
  $wIdx = [int]$bits[0]
  Write-Host ("  Q{0,2} = w#{1,2} ({2})" -f ($j+1), $wIdx, $part1_words[$wIdx])
  $j++
}

$part2_phrases = @(
  'travel preparation','travel essentials','water bottle','hiking boots','first-aid kit',
  'travel adapter','mobile phone charger','take a passport','travel abroad',
  'on our sightseeing trip','be worth trying out some of the local snacks and exploring the city',
  'stop for lunch','visit the food stalls for breakfast','appreciate art','on an empty stomach',
  'persuade sb to do sth','be interested in','try_local_food','go hiking','watch wild animals',
  'do some sightseeing','buy souvenirs from locals'
)
$part2 = @()
for ($i = 0; $i -lt 22; $i++) {
  $part2 += "$i" + "_0"
  $part2 += "$i" + "_1"
}
$attempts2 = 0
while ($attempts2 -lt $max) {
  $shuffled2 = $part2 | Sort-Object { $rng.Next() }
  $ok2 = $true
  for ($k = 0; $k -lt ($shuffled2.Count - 1); $k++) {
    $a = ($shuffled2[$k] -split "_")[0]
    $b = ($shuffled2[$k+1] -split "_")[0]
    if ($a -eq $b) { $ok2 = $false; break }
  }
  if ($ok2) { $part2 = $shuffled2; break }
  $attempts2++
}
Write-Host "Part II (attempts=$attempts2):"
$j = 0
while ($j -lt 44) {
  $bits = $part2[$j] -split "_"
  $pIdx = [int]$bits[0]
  Write-Host ("  Q{0,2} = p#{1,2} ({2})" -f ($j+1), $pIdx, $part2_phrases[$pIdx])
  $j++
}

$topics = @('if_clause','need_to_do','it_is_adj_to_do','wh_inf','be_worth_doing','why_dont_we')
$part3 = @()
for ($i = 0; $i -lt 6; $i++) {
  for ($k = 0; $k -lt 5; $k++) {
    $part3 += "$i" + "_$k"
  }
}
$attempts3 = 0
while ($attempts3 -lt $max) {
  $shuffled3 = $part3 | Sort-Object { $rng.Next() }
  $ok3 = $true
  for ($k = 0; $k -lt ($shuffled3.Count - 1); $k++) {
    $a = ($shuffled3[$k] -split "_")[0]
    $b = ($shuffled3[$k+1] -split "_")[0]
    if ($a -eq $b) { $ok3 = $false; break }
  }
  if ($ok3) { $part3 = $shuffled3; break }
  $attempts3++
}
Write-Host "Part III (attempts=$attempts3):"
$j = 0
while ($j -lt 30) {
  $bits = $part3[$j] -split "_"
  $tIdx = [int]$bits[0]
  Write-Host ("  Q{0,2} = {1} q#{2}" -f ($j+1), $topics[$tIdx], $bits[1])
  $j++
}
