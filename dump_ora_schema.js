// dump_ora_schema.js
// https://github.com/fedapo/oracle_schema_dumper
// federico.aponte@gmail.com

/*
  0. Not managed: LOB, JAVA CLASS
  1. Source code lines: TYPE, TYPE BODY, FUNCTION, PROCEDURE, PACKAGE, PACKAGE BODY, TRIGGER
  2. Using dbms_metadata.get_ddl: SEQUENCE, INDEX, SYNONYM
  3. Custom: TABLE, VIEW

  REVIEW:
  * configuration in external file
  * source code of sequences
  * last line of source code text lines should not contain an end-of-line
  * source code of indexes
  * add a semicolon at the end of types?
  * how to manage tablespaces?
  * indexes can be in status unusable, in this case the code contains an additional "ALTER INDEX DIACODE UNUSABLE" -> raise a warning?
  * grants are not dumped

  DONE:
  * support column definitions such as CHAR(10 CHAR) and VARCHAR2(10 CHAR) -> user_tab_columns.char_used = [B|C]
  * support for table and column comments
  * support tablespace in table definition
  * support primary key, unique, and foreign key constraints
*/
// ADO Constants
var ad = {
  adParamInput: 1, // ParameterDirectionEnum
  adInteger: 3, // DataTypeEnum
  adVarChar: 200, // DataTypeEnum
  adStateOpen: 1, // ObjectStateEnum
  adUseClient: 3, // CursorLocationEnum
  adOpenStatic: 3, // CursorTypeEnum
  adCmdText: 1, // CommandTypeEnum
  adCmdStoredProc: 4, // CommandTypeEnum
  adFieldIsNull: 3 // FieldStatusEnum
};

var obj_type_fileext_map = {
  "TYPE": "tps",
  "TYPE BODY": "tpb",
  "FUNCTION": "fnc",
  "PROCEDURE": "prc",
  "PACKAGE": "spc",
  "PACKAGE BODY": "bdy",
  "TRIGGER": "trg",
  "SEQUENCE": "seq",
  "INDEX": "idx",
  "SYNONYM": "sql",
  "LOB": "lob",
  "JAVA CLASS": "class",
  "VIEW": "sql",
  "TABLE": "sql"
};

var obj_type_folder_map = {
  "TYPE": "types",
  "TYPE BODY": "types",
  "FUNCTION": "functions",
  "PROCEDURE": "procedures",
  "PACKAGE": "packages",
  "PACKAGE BODY": "packages",
  "TRIGGER": "triggers",
  "SEQUENCE": "sequences",
  "INDEX": "indexes",
  "SYNONYM": "synonyms",
  "LOB": "lobs",
  "JAVA CLASS": "classes",
  "VIEW": "views",
  "TABLE": "tables"
};

//------------------------------------------------------------------------------
var dump_dir_;
var log_;
var conn_;
var use_tablespaces_ = true;

function print_usage()
{
  WScript.Echo("dump_ora_schema.js -conf <config_file> -o <output_root_folder>");
}

//------------------------------------------------------------------------------

var IOMode = {
  ForReading: 1,
  ForWriting: 2,
  ForAppending: 8
};

var g_inputfile;
var g_dump_root;

g_inputfile = "schemas.json"; // default configuration file name
g_dump_root = ".";

if(WScript.Arguments.length >= 2)
{
  if(WScript.Arguments(0) == "-conf")
    g_inputfile = WScript.Arguments(1);
  else if(WScript.Arguments(0) == "-o")
    g_dump_root = WScript.Arguments(1);  

  if(WScript.Arguments.length == 4)
  {
    if(WScript.Arguments(2) == "-conf")
      g_inputfile = WScript.Arguments(3);
    else if(WScript.Arguments(2) == "-o")
      g_dump_root = WScript.Arguments(3);  
  }
}

WScript.Echo("g_inputfile = " + g_inputfile);
WScript.Echo("g_dump_root = " + g_dump_root);

var fso = new ActiveXObject("Scripting.FileSystemObject");
var src_file = fso.OpenTextFile(g_inputfile, IOMode.ForReading);
var json_text = src_file.ReadAll();
src_file.Close();

//var g_schemas = JSON.parse(json_text); // only in a modern browser?
var g_schemas = eval(json_text);

for(var i in g_schemas)
  if(g_schemas[i].active)
    main(g_dump_root, g_schemas[i]);

//------------------------------------------------------------------------------
function trim(str)
{
  return str.replace(/^\s+|\s+$/g, "");
}

// UNUSED
// class to create a file for an Oracle object and add code to it in a line-by-line fashion
function file_dumper()
{
  this.fstream_ = null;
  this.escape_sql_ = false;
  
  this.init = function(obj_name, obj_type)
  {
    log_.WriteLine("creating file " + obj_type_folder_map[obj_type] + "/" + obj_name + "." + obj_type_fileext_map[obj_type]);

    this.fstream_ = dump_dir_.CreateTextFile(obj_type_folder_map[obj_type] + "/" + obj_name + "." + obj_type_fileext_map[obj_type]);
  }
  
  this.add_line = function(txt)
  {
    if(this.escape_sql_)
      // sql-escape ampersand (&) by doubling it
      txt = txt.replace(/&/g, "&&");
    
    this.fstream_.WriteLine(txt);
  }
  
  this.close = function()
  {
    this.fstream_.Close();
  }
}

// UNUSED
function sql_dumper(conn)
{
  this.sql_ = null;
  this.conn_ = conn;
  
  this.init = function(obj_name, obj_type)
  {
    this.sql_ = "";
  }
  
  this.add = function(txt)
  {
    this.sql_ += txt;
  }
  
  this.add_line = function(txt)
  {
    this.sql_ += txt + "\r\n";
  }
  
  this.close = function()
  {
    log_.WriteLine("creating db object " + obj_name + " of type " + obj_type);
    this.conn_.Execute(this.sql_);
  }
}

function make_dir_if_none(fso, foldername)
{
  if(!fso.FolderExists(foldername))
    fso.CreateFolder(foldername);
}

function main(dump_root, schema_details)
{
  var fso = new ActiveXObject("Scripting.FileSystemObject");

  var dump_path = dump_root + "/" + schema_details.folder_name;

  dump_dir_ = fso.CreateFolder(dump_path);
  
  // create a folder for each type of Oracle object
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["TYPE"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["TYPE BODY"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["FUNCTION"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["PROCEDURE"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["PACKAGE"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["PACKAGE BODY"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["TRIGGER"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["SEQUENCE"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["INDEX"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["SYNONYM"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["LOB"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["JAVA CLASS"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["VIEW"]);
  make_dir_if_none(fso, dump_path + "/" + obj_type_folder_map["TABLE"]);

  log_ = dump_dir_.CreateTextFile("db_" + schema_details.folder_name + ".log");
  conn_ = new ActiveXObject("ADODB.Connection");

  //var ConnStr = "PROVIDER=MSDAORA"
  var ConnStr = "PROVIDER=OraOLEDB.Oracle"
              + ";DATA SOURCE=" + schema_details.tns
              + ";USER ID=" + schema_details.schema
              + ";PASSWORD=" + schema_details.pwd + ";";

  log_.WriteLine("dump_ora_schema.js");
  log_.WriteLine("------------- Starting ------------- " + Date());
  log_.WriteLine("");
  log_.WriteLine("Dumping schema '" + schema_details.schema + "' - " + schema_details.comment);

  // create the connection
  conn_.CursorLocation = ad.adUseClient;
  conn_.Open(ConnStr);

  write_stats();

  var recset2 = conn_.Execute("select sys_context('USERENV', 'CURRENT_SCHEMA') from dual");

  log_.WriteLine("");
  log_.WriteLine("--------------------------------------------------------------------------------");

  // start the actual work
  file_dump(recset2.Fields(0).Value);

  recset2.Close();

  write_master_sql();

  conn_.Close();
  conn_ = null;

  log_.WriteLine("------------- Finished ------------- " + Date());
}

// log some statistics with the count of objects for each type and the count of tables and indexes for each tablespace 
function write_stats()
{
  // log the number of objects for each type

  var recset = conn_.Execute("select object_type, count(*)" +
                             " from user_objects" +
                             " where object_name not like 'BIN$%'" + // ignore Oracle recycle bin
                             " group by object_type" +
                             " order by object_type");

  var count = 0;

  while(!recset.EOF)
  {
    log_.WriteLine(recset.Fields(0).Value + "\t" + recset.Fields(1).Value);
    count += recset.Fields(1).Value;
    recset.MoveNext();
  }

  recset.Close();

  log_.WriteLine("Total number of objects\t" + count);

  log_.WriteLine("--------------------------------------------------------------------------------");
  log_.WriteLine("Table distribution across tablespaces:");
  log_.WriteLine("");

  // alter table <table-name> move tablespace <new-tablespace>;
  // alter index <index-name> rebuild tablespace <new-tablespace>;

  var recset2 = conn_.Execute("select tablespace_name, count(1)" +
                              " from user_tables" +
                              " where table_name not like 'BIN$%'" +
                              " and temporary = 'N'" +
                              " group by tablespace_name");

  while(!recset2.EOF)
  {
    log_.WriteLine(recset2.Fields(0).Value + "\t" + recset2.Fields(1).Value);
    recset2.MoveNext();
  }

  recset2.Close();

  log_.WriteLine("--------------------------------------------------------------------------------");
  log_.WriteLine("Index distribution across tablespaces:");
  log_.WriteLine("");

  var recset3 = conn_.Execute("select tablespace_name, count(1)" +
                              " from user_indexes" +
                              " where index_name not like 'BIN$%'" +
                              " group by tablespace_name");

  while(!recset3.EOF)
  {
    log_.WriteLine(recset3.Fields(0).Value + "\t" + recset3.Fields(1).Value)
    recset3.MoveNext();
  }

  recset3.Close();
}

// write the script that collects all other files to apply the dumped structure to a new schema
function write_master_sql()
{
  var master_sql = dump_dir_.CreateTextFile("__master.sql");

  master_sql.WriteLine("--");
  
  var recset = conn_.Execute("select object_type, object_name" +
                             " from user_objects" +
                             " where object_name not like 'BIN$%'" +
                             " and object_type in (" +
                             "'TYPE', 'TYPE BODY', 'FUNCTION', 'PROCEDURE'," +
                             "'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'SEQUENCE'," +
                             "'INDEX', 'SYNONYM', 'LOB', 'JAVA CLASS'," +
                             "'VIEW', 'TABLE'" +
                             ")" +
                             " order by object_type, object_name");

  while(!recset.EOF)
  {
    master_sql.WriteLine("@" + obj_type_folder_map[recset.Fields(0).Value] + "/" + recset.Fields(1).Value + "." + obj_type_fileext_map[recset.Fields(0).Value]);
    recset.MoveNext();
  }

  recset.Close();
}

//------------------------------------------------------------------------------

function file_dump(schema)
{
  var cmdo = new ActiveXObject("ADODB.Command");

  // Setup Command Properties
  cmdo.CommandText = "select table_name, tablespace_name, temporary, duration"
                   + " from user_tables"
                   + " where table_name not like 'BIN$%'" // ignore Oracle recycle bin
                   + " order by table_name";
  cmdo.CommandType = ad.adCmdText;
  cmdo.ActiveConnection = conn_;

  var rst = cmdo.Execute();

  while(!rst.EOF)
  {
    dump_table(rst.Fields("TABLE_NAME").Value,
               rst.Fields("TABLESPACE_NAME").Value,
               rst.Fields("TEMPORARY").Value,
               rst.Fields("DURATION").Value != null ? rst.Fields("DURATION").Value : "")

    rst.MoveNext();
  }

  rst.Close();

  // --------------- 
  var cmdo = new ActiveXObject("ADODB.Command");

  // Setup Command Properties
  cmdo.CommandText = "select object_type, object_name from user_objects"
                   + " where object_name not like 'BIN$%'" // ignore Oracle recycle bin
                   + " and object_type != 'TABLE'"
                   + " order by object_type, object_name";
  cmdo.CommandType = ad.adCmdText;
  cmdo.ActiveConnection = conn_;

  //var prmOwn = cmdo.CreateParameter("owner", ad.adVarChar, ad.adParamInput, 50);
  //var prmRow = cmdo.CreateParameter("rows", ad.adInteger, ad.adParamInput);

  // append parameters to command object
  //cmdo.Parameters.Append(prmOwn);
  //cmdo.Parameters.Append(prmRow);

  // assign Parameter Values
  //cmdo(0).Value = "SYS";
  //cmdo(1).Value = 5;
  //cmdo[0].Value = "SYS";
  //cmdo[1].Value = 5;

  var rst = cmdo.Execute();

  while(!rst.EOF)
  {
    if(rst.Fields("OBJECT_TYPE").Value == "TYPE" ||
       rst.Fields("OBJECT_TYPE").Value == "TYPE BODY" ||
       rst.Fields("OBJECT_TYPE").Value == "FUNCTION" ||
       rst.Fields("OBJECT_TYPE").Value == "PROCEDURE" ||
       rst.Fields("OBJECT_TYPE").Value == "PACKAGE" ||
       rst.Fields("OBJECT_TYPE").Value == "PACKAGE BODY" ||
       rst.Fields("OBJECT_TYPE").Value == "TRIGGER")
    {
      dump_source(schema, rst.Fields("OBJECT_TYPE").Value, rst.Fields("OBJECT_NAME").Value);
    }
    else if(rst.Fields("OBJECT_TYPE").Value == "SEQUENCE" ||
            rst.Fields("OBJECT_TYPE").Value == "INDEX" ||
            //rst.Fields("OBJECT_TYPE").Value == "LOB" ||
            //rst.Fields("OBJECT_TYPE").Value == "JAVA CLASS" ||
            rst.Fields("OBJECT_TYPE").Value == "SYNONYM")
    {
      dump_source2(schema, rst.Fields("OBJECT_TYPE").Value, rst.Fields("OBJECT_NAME").Value);
    }
    else if(rst.Fields("OBJECT_TYPE").Value == "VIEW")
    {
      dump_view(rst.Fields("OBJECT_NAME").Value)
    }

    rst.MoveNext();
  }

  rst.Close();
  cmdo = null;
  //prmOwn = null;
  //prmRow = null;
}

// used for TYPE, TYPE BODY, FUNCTION, PROCEDURE, PACKAGE, PACKAGE BODY, TRIGGER
function dump_source(obj_owner, obj_type, obj_name)
{
  var cmd2 = new ActiveXObject("ADODB.Command");

  // setup command properties
  cmd2.CommandText = "select text, line from user_source"
                   + " where type = ?"
                   + " and name = ? order by line";
  cmd2.CommandType = ad.adCmdText;
  cmd2.ActiveConnection = conn_;

  var prmType = cmd2.CreateParameter("obj_type", ad.adVarChar, ad.adParamInput, 50);
  var prmName = cmd2.CreateParameter("obj_name", ad.adVarChar, ad.adParamInput, 50);

  // append parameters to command object
  cmd2.Parameters.Append(prmType);
  cmd2.Parameters.Append(prmName);

  // assign parameter values
  cmd2(0).Value = obj_type;
  cmd2(1).Value = obj_name;

  var rst2 = cmd2.Execute();

  rst2.MoveFirst();

  log_.WriteLine("creating file " + obj_name + "." + obj_type_fileext_map[obj_type]);

  var fstream = dump_dir_.CreateTextFile(obj_type_folder_map[obj_type] + "/" + obj_name + "." + obj_type_fileext_map[obj_type]);
  //dumper.init(obj_name, obj_type);
  
  var curr_text = "";

  while(!rst2.EOF)
  {
    var fld_txt = rst2.Fields("TEXT").Value;

    // performs some actions aimed at code "normalization"
    if(rst2.Fields("LINE").Value == 1)
    {
      // fixes the problem with triggers that sometimes have the schema owner
      // in the first line of the source code as -> trigger "SCHEMA".trigger_name
      curr_text = fld_txt.replace("\"" + obj_owner + "\".", "");

      // fixes the problem with types and triggers that sometimes have the name
      // of the object inside double quotes
      curr_text = curr_text.replace("\"" + obj_name + "\"", obj_name);

      // remove trailing blanks (and line feed)
      curr_text = curr_text.replace(/\s*$/g, "");

      // fixes the problem with types that sometimes have a number of blanks in a row
      curr_text = curr_text.replace(/ +/g, " ");

      curr_text = "create or replace " + curr_text + "\r\n";
    }
    else
    {
      // remove trailing blanks (and line feed)
      curr_text += fld_txt.replace(/\s*$/g, "") + "\r\n";
    }

    rst2.MoveNext();
  }

  // remove trailing blank lines
  curr_text = curr_text.replace(/\s*$/g, "");

  fstream.Write(curr_text + "\r\n");
  //dumper.add(curr_text + "\r\n");

  if(true)
    fstream.Write("/");
  //dumper.add_line("/");

  //dumper.close();

  rst2.Close();
  cmd2 = null;
  prmType = null;
  prmName = null;
}

// used for SEQUENCE, INDEX, SYNONYM
function dump_source2(obj_owner, obj_type, obj_name)
{
  var cmd2 = new ActiveXObject("ADODB.Command");

  // setup command properties
  cmd2.CommandText = "select dbms_metadata.get_ddl(?, ?) from dual";
  cmd2.CommandType = ad.adCmdText;
  cmd2.ActiveConnection = conn_;

  var prmType = cmd2.CreateParameter("obj_type", ad.adVarChar, ad.adParamInput, 50);
  var prmName = cmd2.CreateParameter("obj_name", ad.adVarChar, ad.adParamInput, 50);

  // append parameters to command object
  cmd2.Parameters.Append(prmType);
  cmd2.Parameters.Append(prmName);

  // assign parameter values
  cmd2(0).Value = obj_type;
  cmd2(1).Value = obj_name;

  var rst2 = cmd2.Execute();

  rst2.MoveFirst();

  log_.WriteLine("creating file " + obj_name + "." + obj_type_fileext_map[obj_type]);

  var fstream = dump_dir_.CreateTextFile(obj_type_folder_map[obj_type] + "/" + obj_name + "." + obj_type_fileext_map[obj_type])
  //dumper.init(obj_name, obj_type);

  // why are we scanning? the recordset should only contain one record
  while(!rst2.EOF)
  {
    var curr_text = rst2.Fields(0).Value;

    // fixes the problem with indexes that sometimes have the schema owner
    // in the first line of the source code as -> CREATE INDEX "MYSCHEMA"."MYNAME" ON "MYSCHEMA"."MYNAME" ("MYFIELD")
    curr_text = curr_text.replace(new RegExp("\"" + obj_owner + "\"\\.", "g"), "");

    // fixes the problem with indexes that sometimes have the name
    // of the object inside double quotes
    curr_text = curr_text.replace(new RegExp("\"" + obj_name + "\"", "g"), obj_name);

    // fixes the problem with indexes that sometimes have the tablespace name inside double quotes
    curr_text = curr_text.replace(new RegExp("TABLESPACE \"([A-Za-z0-9_]+)\"", "g"), function($0, $1) { return "TABLESPACE " + $1 });

    // remove all blanks at the beginning of the string (happens very often)
    fstream.WriteLine(trim(curr_text));
    //dumper.add_line(trim(curr_text));
    rst2.MoveNext();
  }

  if(true)
    fstream.Write("/");
    //dumper.add_line("/");

  //dumper.close();

  rst2.Close();
  cmd2 = null;
  prmType = null;
  prmName = null;
}

function dump_table_grants(fstream, tbl_name)
{
  try
  {
    var cmd = new ActiveXObject("ADODB.Command");

    cmd.CommandText = "select grantee, privilege"
                    + " from user_tab_privs"
                    + " where table_name = ?"
                    + " order by grantee";
                    
    cmd.CommandType = ad.adCmdText;
    cmd.ActiveConnection = conn_;

    var prmName = cmd.CreateParameter("tbl_name", ad.adVarChar, ad.adParamInput, 50);

    // append parameters to command object
    cmd.Parameters.Append(prmName);

    // assign parameter values
    cmd(0).Value = tbl_name;

    var rst = cmd.Execute();

    var all_privs = "";
    var flagFirst = true;
    var lastGrantee = "";

    // EXAMPLES:
    //   grant select, insert, update, delete, alter on MY_TABLE to USER1;
    //   grant select on MY_TABLE to USER2;
    while(!rst.EOF)
    {
      if(flagFirst)
      {
        all_privs = rst.Fields("privilege").Value.toLowerCase();
        lastGrantee = rst.Fields("grantee").Value;
        flagFirst = false;
      }
      else
      {
        if(rst.Fields("grantee").Value != lastGrantee)
        {
          fstream.WriteLine("grant " + all_privs + " on " + tbl_name + " to " + lastGrantee + ";");
          all_privs = rst.Fields("privilege").Value.toLowerCase();
          lastGrantee = rst.Fields("grantee").Value;
        }
        else
          all_privs += ", " + rst.Fields("privilege").Value.toLowerCase();
      }

      rst.MoveNext();
    }

    fstream.WriteLine("grant " + all_privs + " on " + tbl_name + " to " + lastGrantee + ";");

    rst.Close();
  }
  catch(e)
  {
    log_.WriteLine("error " + e.description);
  }
}

function dump_table_constraints(fstream, tbl_name)
{
  try
  {
    var cmd = new ActiveXObject("ADODB.Command");

    // setup command properties
    cmd.CommandText = "select"
                    + " c.owner, c.constraint_name, c.constraint_type,"
                    + " c.status, c.generated, c.r_owner,"
                    + " c.r_constraint_name, c.delete_rule, i.tablespace_name"
                    + " from user_constraints c, user_indexes i"
                    + " where c.index_name = i.index_name (+)"
                    + " and c.constraint_type in ('P', 'U', 'R')"
                    + " and c.table_name = ?";
    cmd.CommandType = ad.adCmdText;
    cmd.ActiveConnection = conn_;

    var prmName = cmd.CreateParameter("tbl_name", ad.adVarChar, ad.adParamInput, 50);

    // append parameters to command object
    cmd.Parameters.Append(prmName);

    // assign parameter values
    cmd(0).Value = tbl_name;

    var rst = cmd.Execute();

    while(!rst.EOF)
    {
      var constr;
      if(rst.Fields("generated").Value == "USER NAME")
        constr = " constraint " + rst.Fields("constraint_name").Value;
      else
        constr = "";

      if(rst.Fields("constraint_type").Value == "P")
      {
        fstream.WriteLine("alter table " + tbl_name);
        fstream.Write("  add" + constr + " primary key (");
      }
      else if(rst.Fields("constraint_type").Value == "U")
      {
        fstream.WriteLine("alter table " + tbl_name);
        fstream.Write("  add" + constr + " unique (");
      }
      else if(rst.Fields("constraint_type").Value == "R")
      {
        fstream.WriteLine("alter table " + tbl_name);
        fstream.Write("  add" + constr + " foreign key (");
      }

      var cmd2 = new ActiveXObject("ADODB.Command");

      // setup command properties
      cmd2.CommandText = "select column_name"
                       + " from user_cons_columns"
                       + " where constraint_name = ?"
                       + " order by table_name, position";
      cmd2.CommandType = ad.adCmdText;
      cmd2.ActiveConnection = conn_;

      var prmName2 = cmd2.CreateParameter("constraint_name", ad.adVarChar, ad.adParamInput, 50);

      // append parameters to command object
      cmd2.Parameters.Append(prmName2);

      // assign parameter values
      cmd2(0).Value = rst.Fields("constraint_name").Value;

      var rst2 = cmd2.Execute();

      var flagFirst = true;

      while(!rst2.EOF)
      {
        if(flagFirst)
          flagFirst = false;
        else
          fstream.Write(", ");
        fstream.Write(rst2.Fields(0).Value);

        rst2.MoveNext();
      }

      rst2.Close();

      if(rst.Fields("constraint_type").Value == "P" ||
         rst.Fields("constraint_type").Value == "U")
      {
        if(rst.Fields("status").Value == "DISABLED")
          fstream.WriteLine(")\r\n  disable;");
        else
          fstream.WriteLine(")\r\n" +
                            "  using index\r\n" +
                            "  tablespace " + rst.Fields("tablespace_name").Value + ";");
      }
      else if(rst.Fields("constraint_type").Value == "R")
      {
        var cmd3 = new ActiveXObject("ADODB.Command");

        // setup command properties
        cmd3.CommandText = "select table_name, column_name"
                         + " from user_cons_columns"
                         + " where owner = ?"
                         + " and constraint_name = ?"
                         + " order by table_name, position";
        cmd3.CommandType = ad.adCmdText;
        cmd3.ActiveConnection = conn_;

        var prmName31 = cmd3.CreateParameter("owner", ad.adVarChar, ad.adParamInput, 50);
        var prmName32 = cmd3.CreateParameter("constraint_name", ad.adVarChar, ad.adParamInput, 50);

        // append parameters to command object
        cmd3.Parameters.Append(prmName31);
        cmd3.Parameters.Append(prmName32);

        // assign parameter values
        cmd3(0).Value = rst.Fields("r_owner").Value;
        cmd3(1).Value = rst.Fields("r_constraint_name").Value;

        var rst3 = cmd3.Execute();

        if(!rst3.EOF)
        {
          var referenced;

          if(rst.Fields("r_owner").Value != rst.Fields("owner").Value)
            referenced = rst.Fields("r_owner").Value + "." + rst3.Fields(0).Value;
          else
            referenced = rst3.Fields(0).Value;

          fstream.Write(")\r\n  references " + referenced + " (" + rst3.Fields(1).Value + ")");
        }

        rst3.Close();

        if(rst.Fields("delete_rule").Value == "CASCADE")
            fstream.Write(" on delete cascade");

        if(rst.Fields("status").Value == "DISABLED")
            fstream.Write("\r\n  disable");

        fstream.WriteLine(";");
      }

      rst.MoveNext();
    }

    rst.Close();
  }
  catch(e)
  {
    log_.WriteLine("error " + e.description);
  }
}

function dump_table_comments(fstream, tbl_name)
{
  try
  {
    var cmd = new ActiveXObject("ADODB.Command");

    // setup command properties
    cmd.CommandText = "select comments from user_tab_comments"
                    + " where table_name = ?"
                    + " and comments is not null"
    cmd.CommandType = ad.adCmdText;
    cmd.ActiveConnection = conn_;

    var prmName = cmd.CreateParameter("tbl_name", ad.adVarChar, ad.adParamInput, 50);

    // append parameters to command object
    cmd.Parameters.Append(prmName);

    // assign parameter values
    cmd(0).Value = tbl_name;

    var rst2 = cmd.Execute();

    if(!rst2.EOF)
    //if(!rst2.Fields("comments").Value != null)
    //if(!rst2.Fields("comments").Status != ad.adFieldIsNull)
    {
      fstream.WriteLine("-- Add comments to the table");
      fstream.WriteLine("comment on table " + tbl_name);
      fstream.WriteLine("  is '" + rst2.Fields("comments").Value.replace(/'/g, "''") + "';"); // sql-escape single quotes by doubling them
    }

    rst2.Close();
    cmd = null;
    prmName = null;

    //--------------------------------------------------------------------

    var cmd = new ActiveXObject("ADODB.Command");

    // setup command properties
    cmd.CommandText = "select c.column_name, comments"
                    + " from user_col_comments c, user_tab_columns f"
                    + " where c.table_name = f.table_name"
                    + " and c.column_name = f.column_name"
                    + " and c.table_name = ?"
                    + " and comments is not null"
                    + " order by column_id";
    cmd.CommandType = ad.adCmdText;
    cmd.ActiveConnection = conn_;

    var prmName = cmd.CreateParameter("tbl_name", ad.adVarChar, ad.adParamInput, 50);

    // append parameters to command object
    cmd.Parameters.Append(prmName);

    // assign parameter values
    cmd(0).Value = tbl_name;

    var rst2 = cmd.Execute();

    if(!rst2.EOF)
      fstream.WriteLine("-- Add comments to the columns");

    while(!rst2.EOF)
    {
      fstream.WriteLine("comment on column " + tbl_name + "." + rst2.Fields("column_name").Value);
      fstream.WriteLine("  is '" + rst2.Fields("comments").Value.replace(/'/g, "''") + "';"); // sql-escape single quotes by doubling them

      rst2.MoveNext();
    }

    rst2.Close();
    cmd = null;
    prmName = null;
  }
  catch(e)
  {
    log_.WriteLine("error " + e.description);
  }
}

function dump_table(tbl_name, tblspc_name, temp, duration)
{
  try
  {
    var cmd2 = new ActiveXObject("ADODB.Command");

    // setup command properties
    cmd2.CommandText = "select count(*) from user_tab_columns where table_name = ?";
    cmd2.CommandType = ad.adCmdText;
    cmd2.ActiveConnection = conn_;

    var prmName = cmd2.CreateParameter("tbl_name", ad.adVarChar, ad.adParamInput, 50);

    // append parameters to command object
    cmd2.Parameters.Append(prmName);

    // assign parameter values
    cmd2(0).Value = tbl_name;

    var rst2 = cmd2.Execute();

    rst2.MoveFirst();

    var l_count = rst2.Fields(0).Value;

    rst2.Close();
    rst2 = 0;
    cmd2 = 0;
    prmName = 0;

    // ---
    var cmd2 = new ActiveXObject("ADODB.Command");

    // setup command properties
    cmd2.CommandText = "select * from user_tab_columns" +
                       " where table_name = ? order by column_id";
    cmd2.CommandType = ad.adCmdText;
    cmd2.ActiveConnection = conn_;

    var prmName = cmd2.CreateParameter("tbl_name", ad.adVarChar, ad.adParamInput, 50);

    // append parameters to command object
    cmd2.Parameters.Append(prmName);

    // assign parameter values
    cmd2(0).Value = tbl_name;

    var rst2 = cmd2.Execute();

    rst2.MoveFirst();

    log_.WriteLine("creating file " + tbl_name + "." + obj_type_fileext_map["TABLE"]);

    var fstream = dump_dir_.CreateTextFile(obj_type_folder_map["TABLE"] + "/" + tbl_name + "." + obj_type_fileext_map["TABLE"]);
    //dumper.init(tbl_name, "TABLE");

    if(temp == "Y")
    {
      fstream.WriteLine("create global temporary table " + rst2.Fields("TABLE_NAME").Value);
      fstream.WriteLine("(");
    }
    else
    {
      fstream.WriteLine("create table " + rst2.Fields("TABLE_NAME").Value);
      fstream.WriteLine("(");
    }
    //dumper.add_line("create table " + rst2.Fields("TABLE_NAME").Value);
    //dumper.add_line("(");

    while(!rst2.EOF)
    {
      var l_line = new String();

      if(rst2.Fields("data_type").Value == "CHAR" ||
         rst2.Fields("data_type").Value == "VARCHAR2" ||
         rst2.Fields("data_type").Value == "RAW")
      {
        // check for the length semantics (char or byte)
        if(rst2.Fields("char_used").Value == "C")
            l_line += "  " + rst2.Fields("column_name").Value + " " + rst2.Fields("data_type").Value + "(" + rst2.Fields("data_length").Value + " CHAR)";
        else
            l_line += "  " + rst2.Fields("column_name").Value + " " + rst2.Fields("data_type").Value + "(" + rst2.Fields("data_length").Value + ")";
      }
      else if(rst2.Fields("data_type").Value == "NVARCHAR2")
        // the data length for the type nvarchar2 should be halved (two-byte character enconding)
        l_line += "  " + rst2.Fields("column_name").Value + " NVARCHAR2(" + rst2.Fields("data_length").Value/2 + ")";
      else if(rst2.Fields("data_type").Value == "NUMBER")
      {
        // NUMBER(null,null) -> NUMBER
        // NUMBER(null,0) -> INTEGER
        if(rst2.Fields("data_precision").Value == null && rst2.Fields("data_scale").Value == null)
          l_line += "  " + rst2.Fields("column_name").Value + " NUMBER";
        else if(rst2.Fields("data_precision").Value == null && rst2.Fields("data_scale").Value == 0)
          l_line += "  " + rst2.Fields("column_name").Value + " INTEGER";
        else
          l_line += "  " + rst2.Fields("column_name").Value + " " + rst2.Fields("data_type").Value + "(" + rst2.Fields("data_precision").Value + "," + rst2.Fields("data_scale").Value + ")";
      }
      else
        l_line += "  " + rst2.Fields("column_name").Value + " " + rst2.Fields("data_type").Value;

      if(rst2.Fields("data_default").Value != null)
      //if(rst2.Fields("data_default").Status != ad.adFieldIsNull)
      //  l_line += " default " + trim(substr(rst2.Fields("data_default").Value, 1, rst2.Fields("default_length").Value));
        l_line += " default " + trim(rst2.Fields("data_default").Value);

      if(rst2.Fields("nullable").Value == "N")
        l_line += " not null";

      if(rst2.Fields("column_id").Value != l_count)
        l_line += ",";

      fstream.WriteLine(l_line);
      //dumper.add_line(l_line);
      rst2.MoveNext();
    }

    //dumper.add_line(");");
    if(temp == "Y")
    {
      if(duration == "SYS$TRANSACTION")
      {
        fstream.WriteLine(")");
        fstream.WriteLine("on commit delete rows;");
      }
      else if(duration == "SYS$SESSION")
      {
        fstream.WriteLine(")");
        fstream.WriteLine("on commit preserve rows;");
      }
    }
    else
    {
      if(use_tablespaces_)
      {
        fstream.WriteLine(")");
        fstream.WriteLine("tablespace " + tblspc_name + ";");
/*
        fstream.WriteLine("  pctfree " + "PCT_FREE");
        fstream.WriteLine("  initrans " + "INI_TRANS");
        fstream.WriteLine("  maxtrans " + "MAX_TRANS");
        fstream.WriteLine("  storage");
        fstream.WriteLine("  (");
        fstream.WriteLine("    initial " + "INITIAL_EXTENT");
        fstream.WriteLine("    minextents " + "MIN_EXTENTS");
        fstream.WriteLine("    maxextents " + "MAX_EXTENTS");
        fstream.WriteLine("  );")
*/
      }
      else
      {
        fstream.WriteLine(");");
      }
    }

    //dumper.close();

    rst2.Close();
    cmd2 = null;
    prmName = null;
  
    dump_table_comments(fstream, tbl_name);
    dump_table_constraints(fstream, tbl_name);
    dump_table_grants(fstream, tbl_name);
  }
  catch(e)
  {
    log_.WriteLine("error " + e.description);
  }
}

function dump_view(vw_name)
{
  try
  {
    var cmd2 = new ActiveXObject("ADODB.Command");

    // setup command properties
    cmd2.CommandText = "select * from user_views where view_name = ?";
    cmd2.CommandType = ad.adCmdText;
    cmd2.ActiveConnection = conn_;

    var prmName = cmd2.CreateParameter("vw_name", ad.adVarChar, ad.adParamInput, 50);

    // append parameters to command object
    cmd2.Parameters.Append(prmName);

    // assign parameter values
    cmd2(0).Value = vw_name;

    var rst2 = cmd2.Execute();

    rst2.MoveFirst();

    log_.WriteLine("creating file " + vw_name + "." + obj_type_fileext_map["VIEW"]);

    var fstream = dump_dir_.CreateTextFile(obj_type_folder_map["VIEW"] + "/" + vw_name + "." + obj_type_fileext_map["VIEW"]);
    //dumper.init(vw_name, "VIEW");

    fstream.WriteLine("create or replace view " + vw_name + " as");
    //dumper.add_line("create or replace view " + vw_name + " as");

    while(!rst2.EOF)
    {
      // right trim the source code and add a semicolon
      var text = rst2.Fields("TEXT").Value.replace(/\s\s*$/, "") + ";";
      fstream.WriteLine(text);
      //dumper.add_line(text);
      rst2.MoveNext();
    }

    //dumper.close();

    rst2.Close();
    cmd2 = null;
    prmName = null;
  }
  catch(e)
  {
    log_.WriteLine("error " + e.description);
  }
}
