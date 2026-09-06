#!/bin/sh
# usage: lstrange.sh <listing> <startHex> <endHex>  -- print listing lines whose address falls in [start,end)
awk -v s="$2" -v e="$3" 'BEGIN{s=strtonum("0x" s); e=strtonum("0x" e)} /^[0-9A-F][0-9A-F][0-9A-F][0-9A-F]  /{a=strtonum("0x" substr($0,1,4)); p=(a>=s && a<e)} p' "$1"
