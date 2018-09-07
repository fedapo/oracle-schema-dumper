# dump_ora_schema.py
# https://github.com/fedapo/oracle-schema-dumper
# federico.aponte@gmail.com

from __future__ import print_function
import json
import os
import string
import re
import datetime
import getopt
import sys
import cx_Oracle
import contextlib

#------------------------------------------------------------------------------
#  0. Not managed: LOB, JAVA CLASS
#  1. Source code lines: TYPE, TYPE BODY, FUNCTION, PROCEDURE, PACKAGE, PACKAGE BODY, TRIGGER
#  2. Using dbms_metadata.get_ddl: SEQUENCE, INDEX, SYNONYM
#  3. Custom: TABLE, VIEW
#
#  REVIEW:
#  * configuration in external file
#  * source code of sequences
#  * last line of source code text lines should not contain an end-of-line
#  * source code of indexes
#  * add a semicolon at the end of types?
#  * how to manage tablespaces?
#  * indexes can be in status unusable, in this case the code contains an additional "ALTER INDEX DIACODE UNUSABLE" -> raise a warning?
#  * grants of the user of the schema
#
#  DONE:
#  * support column definitions such as CHAR(10 CHAR) and VARCHAR2(10 CHAR) -> user_tab_columns.char_used = [B|C]
#  * support for table and column comments
#  * support tablespace in table definition
#  * support primary key, unique, and foreign key constraints
#  * grants on tables belonging to the schema

obj_type_fileext_map = {
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
}

obj_type_folder_map = {
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
}

#------------------------------------------------------------------------------
dump_path_ = None
log_ = None
conn_ = None
use_tablespaces_ = True

# UNUSED
# class to create a file for an Oracle object and add code to it in a line-by-line fashion
class file_dumper:
    def __init__(self):
        self.fstream_ = None
        self.escape_sql_ = False

    """
    def __enter__(self):
        return self

    def __exit__(self, type, value, traceback):
        close(self)
    """

    def init(self, obj_name, obj_type):
        log_.write("creating file %s.%s\r\n" % (obj_name, obj_type_fileext_map[obj_type]))

        self.fstream_ = open("%s/%s/%s.%s" % (dump_path_, obj_type_folder_map[obj_type], obj_name, obj_type_fileext_map[obj_type]), "wb")

    def add_line(self, txt):
        if self.escape_sql_:
            # sql-escape ampersand (&) by doubling it
            txt = txt.replace("&", "&&")

        self.fstream_.write(txt + "\r\n")

    def close(self):
        self.fstream_.close()

# UNUSED
class sql_dumper():
    def __init__(self, conn):
        self.sql_ = None
        self.conn_ = conn

    def init(self, obj_name, obj_type):
        self.sql_ = ""

    def add_line(self, txt):
        self.sql_ += txt

    def close(self):
        log_.write("creating db object %s of type %s\r\n" % (obj_name, obj_type))
        self.conn_.execute(self.sql_)

def make_dir_if_none(dirname):
    if not os.path.exists(dirname):
        os.mkdir(dirname)
        
def main(dump_root, schema_details):
    global dump_path_
    global log_
   
    print("Dumping schema '" + schema_details["schema"] + "' - " + schema_details["comment"])

    dump_path_ = dump_root + "/" + schema_details["folder_name"]
    os.mkdir(dump_path_)

    # create a folder for each type of Oracle object
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["TYPE"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["TYPE BODY"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["FUNCTION"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["PROCEDURE"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["PACKAGE"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["PACKAGE BODY"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["TRIGGER"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["SEQUENCE"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["INDEX"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["SYNONYM"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["LOB"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["JAVA CLASS"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["VIEW"])
    make_dir_if_none(dump_path_ + "/" + obj_type_folder_map["TABLE"])

    log_ = open("%s/db_%s.log" % (dump_path_, schema_details["folder_name"]), "wb")

    log_.write("dump_ora_schema.py\r\n")
    log_.write("------------- Starting ------------- %s\r\n\r\n" % str(datetime.datetime.now())) # datetime.date.today()
    log_.write("Dumping schema '%s' - %s\r\n" % (schema_details["schema"], schema_details["comment"]))

    # create the connection
    global conn_
    conn_ = cx_Oracle.connect("%s/%s@%s" % (schema_details["schema"], schema_details["pwd"], schema_details["tns"]))

    write_stats()

    with contextlib.closing(conn_.cursor()) as cursor:
        cursor.execute("select sys_context('USERENV', 'CURRENT_SCHEMA') from dual")

        log_.write("\r\n")
        log_.write("--------------------------------------------------------------------------------\r\n")

        # start the actual work
        file_dump(cursor.fetchone()[0])

    write_master_sql()

    conn_.close()

    log_.write("------------- Finished ------------- %s\r\n" % str(datetime.datetime.now())) # datetime.date.today()

# log some statistics with the count of objects for each type and the count of tables and indexes for each tablespace 
def write_stats():
    # log the number of objects for each type
    # NOTE: ignore Oracle recycle bin

    with contextlib.closing(conn_.cursor()) as crsr:
        crsr.execute("select object_type, count(*)" \
                     " from user_objects" \
                     " where object_name not like 'BIN$%'" \
                     " group by object_type" \
                     " order by object_type")

        count = 0

        for column_1, column_2 in crsr.fetchall():
            log_.write("%s\t%d\r\n" % (column_1, column_2))
            count = count + column_2

    log_.write("Total number of objects\t%d\r\n\r\n" % count)

    log_.write("--------------------------------------------------------------------------------\r\n")
    log_.write("Table distribution across tablespaces:\r\n\r\n")

    # alter table <table-name> move tablespace <new-tablespace>;
    # alter index <index-name> rebuild tablespace <new-tablespace>;

    with contextlib.closing(conn_.cursor()) as crsr:
        crsr.execute("select tablespace_name, count(1)" \
                     " from user_tables" \
                     " where table_name not like 'BIN$%'" \
                     " and temporary = 'N'" \
                     " group by tablespace_name")

        for tblspace_name, cnt in crsr.fetchall():
            log_.write("%s\t%d\r\n" % (tblspace_name, cnt))

    log_.write("--------------------------------------------------------------------------------\r\n")
    log_.write("Index distribution across tablespaces:\r\n\r\n")

    with contextlib.closing(conn_.cursor()) as crsr:
        crsr.execute("select tablespace_name, count(1)" \
                     " from user_indexes" \
                     " where index_name not like 'BIN$%'" \
                     " group by tablespace_name")

        for tblspace_name, cnt in crsr.fetchall():
            log_.write("%s\t%d\r\n" % (tblspace_name, cnt))

# write the script that collects all other files to apply the dumped structure to a new schema
def write_master_sql():
    with open("%s/__master.sql" % dump_path_, "wb") as master_sql:
        master_sql.write("--\r\n")
        
        with contextlib.closing(conn_.cursor()) as crsr:
            crsr.execute("select object_type, object_name" \
                         " from user_objects" \
                         " where object_name not like 'BIN$%'" \
                         " and object_type in (" \
                         "'TYPE', 'TYPE BODY', 'FUNCTION', 'PROCEDURE'," \
                         "'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'SEQUENCE'," \
                         "'INDEX', 'SYNONYM', 'LOB', 'JAVA CLASS'," \
                         "'VIEW', 'TABLE'" \
                         ")" \
                         " order by object_type, object_name")

            for obj_type, obj_name in crsr.fetchall():
                master_sql.write("@%s/%s.%s\r\n" % (obj_type_folder_map[obj_type], obj_name, obj_type_fileext_map[obj_type]))

#------------------------------------------------------------------------------

def file_dump(schema):
    global conn_

    # -------------- dump tables

    with contextlib.closing(conn_.cursor()) as rst:
        # NOTE: ignore Oracle recycle bin (BIN$...)
        rst.execute("select table_name, tablespace_name, temporary, duration, iot_type" \
                    " from user_tables" \
                    " where table_name not like 'BIN$%'" \
                    " order by table_name")

        for col1, col2, col3, col4, col5 in rst.fetchall():
            dump_table(col1, col2, col3, col4, col5)

    # -------------- dump all other objects

    with contextlib.closing(conn_.cursor()) as rst:
        # NOTE: ignore Oracle recycle bin (BIN$...)
        rst.execute("select object_type, object_name from user_objects" \
                     " where object_name not like 'BIN$%'" \
                     " and object_type != 'TABLE'" \
                     " order by object_type, object_name")

        for col1, col2 in rst.fetchall():
            if col1 in ("TYPE", "TYPE BODY", "FUNCTION", "PROCEDURE", "PACKAGE", "PACKAGE BODY", "TRIGGER"):
                dump_source(schema, col1, col2)
            elif col1 in ("SEQUENCE", "INDEX", "SYNONYM"):
            #elif col1 in ("SEQUENCE", "INDEX", "LOB", "JAVA CLASS", "SYNONYM"):
                dump_source2(schema, col1, col2)
            elif col1 == "VIEW":
                dump_view(col2)

    # -------------- dump public synonyms that refer to the current schema
"""
    with contextlib.closing(conn_.cursor()) as rst:
        # NOTE: ignore Oracle recycle bin
        rst.execute("select synonym_name, table_name from dba_synonyms" \
                    " where owner = 'PUBLIC'" \
                    " and synonym_name not like 'BIN$%'" \
                    " and table_owner = :arg", arg = schema)

        for synonym_name, table_name in rst.fetchall():
            dump_source2(schema, "SYNONYM", synonym_name)
"""

# used for TYPE, TYPE BODY, FUNCTION, PROCEDURE, PACKAGE, PACKAGE BODY, TRIGGER
def dump_source(obj_owner, obj_type, obj_name):
    with contextlib.closing(conn_.cursor()) as rst2:
        rst2.execute("select text, line from user_source" \
                     " where type = :arg1 and name = :arg2 order by line",
                     arg1 = obj_type, arg2 = obj_name)

        log_.write("creating file %s.%s\r\n" % (obj_name, obj_type_fileext_map[obj_type]))

        with open("%s/%s/%s.%s" % (dump_path_, obj_type_folder_map[obj_type], obj_name, obj_type_fileext_map[obj_type]), "wb") as fstream:
            #dumper.init(obj_name, obj_type)

            p = re.compile("  +")
            re_trailingblanks = re.compile(r"\s*$")

            for fld1, fld2 in rst2.fetchall():
                # performs some actions aimed at code "normalization"
                if fld2 == 1:
                    # fixes the problem with triggers that sometimes have the schema owner
                    # in the first line of the source code as -> trigger "SCHEMA".trigger_name
                    curr_text = fld1.replace("\"" + obj_owner + "\".", "")

                    # fixes the problem with types and triggers that sometimes have the name
                    # of the object inside double quotes
                    curr_text = curr_text.replace("\"" + obj_name + "\"", obj_name)

                    # remove trailing blanks
                    curr_text = re_trailingblanks.sub("", curr_text)

                    # fixes the problem with types that sometimes have a number of blanks in a row
                    curr_text = p.sub(" ", curr_text) + "\r\n"
                else:
                    curr_text += re_trailingblanks.sub("", fld1) + "\r\n" # remove trailing blanks

            fstream.write("create or replace ")
            fstream.write(re_trailingblanks.sub("", curr_text)) # remove trailing blank lines
            #dumper.add_line("create or replace ")
            #dumper.add_line(curr_text)

            if True:
                fstream.write("\r\n/")
                #dumper.add_line("/")

            #dumper.close()

# used for SEQUENCE, INDEX, SYNONYM
def dump_source2(obj_owner, obj_type, obj_name):
    with contextlib.closing(conn_.cursor()) as rst2:
        rst2.execute("select dbms_metadata.get_ddl(:arg1, :arg2) from dual", \
                     arg1 = obj_type, arg2 = obj_name)

        log_.write("creating file %s.%s\r\n" % (obj_name, obj_type_fileext_map[obj_type]))

        with open("%s/%s/%s.%s" % (dump_path_, obj_type_folder_map[obj_type], obj_name, obj_type_fileext_map[obj_type]), "wb") as fstream:
            #dumper.init(obj_name, obj_type)

            fld1 = rst2.fetchone()[0] # first and only record
            curr_text = str(fld1)

            # fixes the problem with indexes that sometimes have the schema owner
            # in the first line of the source code as -> CREATE INDEX "MYSCHEMA"."MYNAME" ON "MYSCHEMA"."MYNAME" ("MYFIELD")
            curr_text = curr_text.replace("\"" + obj_owner + "\".", "")

            # fixes the problem with indexes that sometimes have the name
            # of the object inside double quotes
            curr_text = curr_text.replace("\"" + obj_name + "\"", obj_name)

            # fixes the problem with indexes that sometimes have the tablespace name inside double quotes
            curr_text = re.sub("TABLESPACE \"([A-Za-z0-9_]+)\"", r"TABLESPACE \1", curr_text)
            
            # remove all blanks at the beginning of the string (happens very often)
            fstream.write(curr_text.strip() + "\r\n")
            #dumper.add_line(curr_text.strip())

            if True:
                fstream.write("/")
                #dumper.add_line("/")

            #dumper.close()

def dump_table_grants(fstream, tbl_name):
    with contextlib.closing(conn_.cursor()) as crsr:
        crsr.execute("select grantee, privilege" \
                     " from user_tab_privs" \
                     " where table_name = :arg" \
                     " order by grantee", arg = tbl_name)

        all_privs = ""
        flagFirst = True
        lastGrantee = ""

        # EXAMPLES:
        #   grant select, insert, update, delete, alter on MY_TABLE to USER1;
        #   grant select on MY_TABLE to USER2;
        for grantee, privilege in crsr.fetchall():
            if flagFirst:
                all_privs = privilege.lower()
                lastGrantee = grantee
                flagFirst = False
            else:
                if grantee != lastGrantee:
                    fstream.write("grant %s on %s to %s;\r\n" % (all_privs, tbl_name, lastGrantee))
                    all_privs = privilege.lower()
                    lastGrantee = grantee
                else:
                    all_privs += ", " + privilege.lower()

        fstream.write("grant %s on %s to %s;\r\n" % (all_privs, tbl_name, lastGrantee))

def dump_table_constraints(fstream, tbl_name):
    with contextlib.closing(conn_.cursor()) as crsr:
        crsr.execute("select" \
                     " c.owner, c.constraint_name, c.constraint_type," \
                     " c.status, c.generated, c.r_owner," \
                     " c.r_constraint_name, c.delete_rule, i.tablespace_name" \
                     " from user_constraints c, user_indexes i" \
                     " where c.index_name = i.index_name (+)" \
                     " and c.constraint_type in ('P', 'U', 'R')" \
                     " and c.table_name = :arg", arg = tbl_name)

        for owner, constraint_name, constraint_type, status, generated, r_owner, r_constraint_name, delete_rule, tblspace_name in crsr.fetchall():
            if generated == "USER NAME":
                constr = " constraint %s" % constraint_name
            else:
                constr = ""

            if constraint_type == "P":
                fstream.write("alter table %s\r\n" \
                              "  add%s primary key (" % (tbl_name, constr))
            elif constraint_type == "U":
                fstream.write("alter table %s\r\n" \
                              "  add%s unique (" % (tbl_name, constr))
            elif constraint_type == "R":
                fstream.write("alter table %s\r\n" \
                              "  add%s foreign key (" % (tbl_name, constr))

            with contextlib.closing(conn_.cursor()) as crsr2:
                crsr2.execute("select column_name" \
                              " from user_cons_columns" \
                              " where constraint_name = :arg" \
                              " order by table_name, position", arg = constraint_name)
          
                flagFirst = True

                for it in crsr2.fetchall():
                    if flagFirst:
                        flagFirst = False
                    else:
                        fstream.write(", ")
                    fstream.write(it[0])

            if constraint_type in ("P", "U"):
                if status == "DISABLED":
                    fstream.write(")\r\n  disable;\r\n")
                else:
                    fstream.write(")\r\n" \
                                  "  using index\r\n" \
                                  "  tablespace %s;\r\n" % tblspace_name)
            elif constraint_type == "R":
                with contextlib.closing(conn_.cursor()) as crsr3:
                    crsr3.execute("select table_name, column_name" \
                                  " from user_cons_columns" \
                                  " where owner = :arg1" \
                                  " and constraint_name = :arg2" \
                                  " order by table_name, position", arg1 = r_owner, arg2 = r_constraint_name)

                    row = crsr3.fetchone()

                    if r_owner != owner:
                        referenced = r_owner + "." + row[0]
                    else:
                        referenced = row[0]

                    fstream.write(")\r\n" \
                                  "  references %s (%s)" % (referenced, row[1]))

                if delete_rule == "CASCADE":
                    fstream.write(" on delete cascade")

                if status == "DISABLED":
                    fstream.write("\r\n  disable")

                fstream.write(";\r\n")
    
def dump_table_comments(fstream, tbl_name):
    with contextlib.closing(conn_.cursor()) as crsr:
        crsr.execute("select comments from user_tab_comments" \
                     " where table_name = :arg1" \
                     " and comments is not null", arg1 = tbl_name)

        row = crsr.fetchone()
        
        if row:
            fstream.write("-- Add comments to the table\r\n")
            fstream.write("comment on table %s\r\n" % tbl_name)
            fstream.write("  is '%s';\r\n" % row[0].replace("'", "''")) # escape single quotes

    #--------------------------------------------------------------

    with contextlib.closing(conn_.cursor()) as crsr:
        crsr.execute("select c.column_name, comments" \
                     " from user_col_comments c, user_tab_columns f" \
                     " where c.table_name = f.table_name" \
                     " and c.column_name = f.column_name" \
                     " and c.table_name = :arg1" \
                     " and comments is not null" \
                     " order by column_id", arg1 = tbl_name)

        flagFirst = True

        for fld1, fld2 in crsr.fetchall():
            if flagFirst:
                fstream.write("-- Add comments to the columns\r\n")
                flagFirst = False
            fstream.write("comment on column %s.%s\r\n" % (tbl_name, fld1))
            fstream.write("  is '%s';\r\n" % fld2.replace("'", "''")) # escape single quotes

def dump_table(tbl_name, tblspc_name, temp, duration, iot_type):
#    try:
        with contextlib.closing(conn_.cursor()) as rst2:
            rst2.execute("select count(*) from user_tab_columns where table_name = :arg1", arg1 = tbl_name)

            l_count = rst2.fetchone()[0]

        # ---
        with contextlib.closing(conn_.cursor()) as rst2:
            rst2.execute("select" \
                         " data_type, data_precision, data_scale, column_name, data_length, data_default, nullable, column_id, char_used" \
                         " from user_tab_columns" \
                         " where table_name = :arg1 order by column_id", arg1 = tbl_name)

            log_.write("creating file %s.%s\r\n" % (tbl_name, obj_type_fileext_map["TABLE"]))

            with open("%s/%s/%s.%s" % (dump_path_, obj_type_folder_map["TABLE"], tbl_name, obj_type_fileext_map["TABLE"]), "wb") as fstream:
                #dumper.init(tbl_name, "TABLE")

                if temp == "Y":
                    fstream.write("create global temporary table %s\r\n(\r\n" % tbl_name)
                else:
                    fstream.write("create table %s\r\n(\r\n" % tbl_name)

                for fld1, fld2, fld3, fld4, fld5, fld6, fld7, fld8, fld9 in rst2.fetchall():
                    l_line = ""

                    if fld1 in ("CHAR", "VARCHAR2", "RAW"):
                        # check for the length semantics (char or byte)
                        if fld9 == "C":
                            l_line += "  " + fld4 + " " + fld1 + "(%d CHAR)" % fld5
                        else:
                            l_line += "  " + fld4 + " " + fld1 + "(%d)" % fld5
                    elif fld1 == "NVARCHAR2":
                        # the data length for the type nvarchar2 should be halved (two-byte character enconding)
                        l_line += "  " + fld4 + " NVARCHAR2(%d)" % (fld5/2)
                    elif fld1 == "NUMBER":
                        # NUMBER(null,null) -> NUMBER
                        # NUMBER(null,0) -> INTEGER
                        if fld2 == None and fld3 == None:
                            l_line += "  " + fld4 + " NUMBER"
                        elif fld2 == None and fld3 == 0:
                            l_line += "  " + fld4 + " INTEGER"
                        else:
                            l_line += "  " + fld4 + " " + fld1 + "(%d,%d)" % (fld2, fld3)
                    else:
                        l_line += "  " + fld4 + " " + fld1

                    if fld6 != None:
                    #if rst2.Fields("data_default").Status != adFieldIsNull:
                        #l_line += " default " + substr(fld6, 1, rst2.Fields("default_length").Value).strip()
                        l_line += " default " + fld6.strip()

                    if fld7 == "N":
                        l_line += " not null"

                    if fld8 != l_count:
                        l_line += ","

                    fstream.write(l_line + "\r\n")
                    #dumper.add_line(l_line)

                fstream.write(")")

                if temp == "Y":
                    if duration == "SYS$TRANSACTION":
                        fstream.write("\r\n" \
                                      "on commit delete rows;\r\n")
                    elif duration == "SYS$SESSION":
                        fstream.write("\r\n" \
                                      "on commit preserve rows;\r\n")
                elif iot_type == "IOT":
                    fstream.write("\r\n" \
                                  "organization index;\r\n")
                else:
                    if use_tablespaces_ and tblspc_name != None:
                        fstream.write("\r\n" \
                                      "tablespace " + tblspc_name + ";\r\n")
                        #fstream.write("  pctfree \r\n" + "PCT_FREE")
                        #fstream.write("  initrans \r\n" + "INI_TRANS")
                        #fstream.write("  maxtrans \r\n" + "MAX_TRANS")
                        #fstream.write("  storage\r\n")
                        #fstream.write("  (\r\n")
                        #fstream.write("    initial \r\n" + "INITIAL_EXTENT")
                        #fstream.write("    minextents \r\n" + "MIN_EXTENTS")
                        #fstream.write("    maxextents \r\n" + "MAX_EXTENTS")
                        #fstream.write("  );\r\n")
                    else:
                        fstream.write(";\r\n")

                #dumper.add_line(");")

                #dumper.close()
                
                dump_table_comments(fstream, tbl_name)
                dump_table_constraints(fstream, tbl_name)
                dump_table_grants(fstream, tbl_name)
    #except Exception as inst:
    #    print >> log_, type(inst)     # the exception instance
    #    print >> log_, inst.args      # arguments stored in .args
    #    print >> log_, inst           # __str__ allows args to printed directly
    #    log_.write("error\r\n")

def dump_view(vw_name):
    #try:
        with contextlib.closing(conn_.cursor()) as rst2:
            rst2.execute("select TEXT from user_views where view_name = :arg1", arg1 = vw_name)

            log_.write("creating file %s.%s\r\n" % (vw_name, obj_type_fileext_map["VIEW"]))

            with open("%s/%s/%s.%s" % (dump_path_, obj_type_folder_map["VIEW"], vw_name, obj_type_fileext_map["VIEW"]), "wb") as fstream:
                #dumper.init(vw_name, "VIEW")

                fstream.write("create or replace view %s as\r\n" % vw_name)
                #dumper.add_line("create or replace view " + vw_name + " as")

                p = re.compile(r"\s+$") # trailing blanks

                for fld1 in rst2.fetchall():
                    # right trim the source code and add a semicolon
                    text = p.sub("", str(fld1[0])) + ";" # FED why do we need [0] ???
                    fstream.write(text + "\r\n")
                    #dumper.add_line(text)

                #dumper.close()
    #except Exception as inst:
    #    print >> log_, type(inst)     # the exception instance
    #    print >> log_, inst.args      # arguments stored in .args
    #    print >> log_, inst           # __str__ allows args to printed directly
    #    log_.write("error\r\n")
#------------------------------------------------------------------------------

def print_usage():
    print("dump_ora_schema.py -conf <config_file> -o <output_root_folder>")

if __name__ == "__main__":
    try:
        opts, args = getopt.getopt(sys.argv[1:], "hi:o:", ["help", "input=", "output_root_folder="])
    except getopt.GetoptError:
        print_usage()
        sys.exit(2)

    inputfile = "schemas.json" # default configuration file name
    dump_root = "."
    
    for opt, arg in opts:
        if opt == "-h":
            print_usage()
            sys.exit()
        elif opt == "-conf":
            inputfile = arg
        elif opt == "-o":
            dump_root = arg
         
    # read the file with the details of each schema to be dumped
    # the file is a JSON array of objects with the following data
    # {
    #   "active"      -> indicates where the dump should really take place
    #   "schema"      -> the name of the schema
    #   "pwd"         -> the password to connect to the schema
    #   "tns"         -> the details of the connection to the Oracle database
    #   "folder_name" -> the name of the folder where to put all files
    #   "comment"     -> a free comment
    # }
    with open(inputfile, "rb") as configfile:
        g_schemas = json.load(configfile)

    #json.dump(g_schemas, open("test_schema_list.json", "wb"))

    for it in g_schemas:
        if it["active"]:
            main(dump_root, it)
