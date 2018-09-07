# oracle-schema-dumper
Tool for exporting all objects in a database schema to a set of files.

### Presentation

This tool allows you to export the complete PL/SQL code and database objects within an Oracle schema to a set of files.
The files are one for each Oracle object (table, view, trigger, procedure, function, type, package, etc.).
These files can be used for off-line inspection, code versioning, etc.
The script is written in Python and requires the cx_Oracle package to work.
A Javascript version for Windows is also provided, it uses OLE DB for database connectivity.

The approach taken is somewhat different from the traditional Oracle tools for creating a database dump, these are aimed at cloning or backing up a schema both in terms of structure and data, thus treat the dump file as a black box.

### Usage

_Python_:

`dump_ora_schema.py -conf schemas_py.json -o C:/Oracle_dumps/py`

_JavaScript_:

For a 32-bit Oracle client installation.

`%SystemRoot%\SysWoW64\cscript.exe dump_ora_schema.js -conf schemas_js.json -o C:/Oracle_dumps/js`

For a 64-bit Oracle client installation (or for a 32-bit Windows version).

`%SystemRoot%\System32\cscript.exe dump_ora_schema.js -conf schemas_js.json -o C:/Oracle_dumps/js`

### To do

### References
