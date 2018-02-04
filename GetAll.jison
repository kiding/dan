/* lexical grammar */
%lex

%%
\s+                  /* skip whitespace */
"byte"               return 'BYTE_T';
"boolean"            return 'BOOLEAN_T';
u?int(16|32|64)      return 'INTEGER_T';
"double"             return 'DOUBLE_T';
"string"             return 'STRING_T';
object\s+path        return 'OBJECT_PATH_T';
"signature"          return 'SIGNATURE_T';
"array"              return 'ARRAY_T';
"of bytes"           return 'OF_BYTES_T';
"struct"             return 'STRUCT_T';
"variant"            return 'VARIANT_T';
dict\s+entry         return 'DICT_ENTRY_T';
unix\s+fd            return 'UNIX_FD_T';

[0-9]{2}\b(?!\.)     return 'HEX_OR_INT';
[0-9a-f]{2}\b(?!\.)  return 'HEX';
[0-9]+\b(?!\.)       return 'INT';
[0-9]+\.[0-9]+\b     return 'FRAC';
\".*\"               return 'STRING';
(true|false)         return 'BOOLEAN';

"-"                  return '-';
"("                  return '(';
")"                  return ')';
"["                  return '[';
"]"                  return ']';
"{"                  return '{';
"}"                  return '}';

<<EOF>>              return 'EOF';

/lex

/* operator associations and precedence */

%start expressions

%% /* language grammar */

expressions: value EOF { return $1; };

value: BYTE_T        hex      { $$ = $2; }
     | BOOLEAN_T     boolean  { $$ = $2; }
     | INTEGER_T     int      { $$ = $2; }
     | DOUBLE_T      frac     { $$ = $2; }
     | DOUBLE_T      int      { $$ = $2; }
     | STRING_T      string   { $$ = $2; }
     | OBJECT_PATH_T string   { $$ = $2; }
     | SIGNATURE_T   string   { $$ = $2; }
     | ARRAY_T       array    { $$ = $2; }
     | STRUCT_T      struct   { $$ = $2; }
     | VARIANT_T     value    { $$ = $2; }
     | UNIX_FD_T     string   { $$ = $2; }
     ;

hex: HEX_OR_INT { $$ = `0x${$1}`; }
   | HEX        { $$ = `0x${$1}`; }
   ;

boolean: BOOLEAN { $$ = $1; };

int: HEX_OR_INT     { $$ = $1;  }
   | '-' HEX_OR_INT { $$ = -$2; }
   | INT            { $$ = $1;  }
   | '-' INT        { $$ = -$2; }
   ;

frac: FRAC       { $$ = $1;  }
    | '-' FRAC   { $$ = -$2; }
    ;

string: STRING { $$ = `${JSON.stringify($1.substr(1, $1.length - 2))}`; };

array: OF_BYTES_T '[' hexes ']' { $$ = `[${$3}]`; }
     | OF_BYTES_T string        { $$ = $2; }
     | '[' entries ']'          { $$ = `{${$2}}`; }
     | '[' values ']'           { $$ = `[${$2}]`; }
     | '[' ']'                  { $$ = '[]'; }
     ;

hexes: hex       { $$ = $1;             }
     | hexes hex { $$ = `${$1}, ${$2}`; }
     ;

entries: entry         { $$ = $1; }
       | entries entry { $$ = `${$1}, ${$2}`; }
       ;

entry: DICT_ENTRY_T '(' STRING_T string value ')' { $$ = `${$4}: ${$5}`; };

values: value        { $$ = $1; }
      | values value { $$ = `${$1}, ${$2}`; }
      ;

struct: '{' values '}' { $$ = `[${$2}]`; }
      | '{' '}'        { $$ = '{}'; }
      ;
