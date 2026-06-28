# Cursor Rules

## Coding Guidelines
- **No Redundant Comments**: Never write JSDoc or inline comments that add zero value if the purpose, parameter types, and return types are already clearly defined by the TypeScript signature. Comment only when explaining non-trivial logic, mathematical formulas, or complex design decisions.
- **Configuration**: Always store configurations, secrets, crop coordinates, and frame-rate settings in the `.env` or other settings file rather than hardcoding them or forcing them solely as command-line options.
- **Top-Down Function Ordering (Stepdown Rule)**: Order functions from highest abstraction to lowest. Place public entrypoints / higher-order functions at the top of the file, and lower-order helper functions underneath them so the code reads like a top-down narrative.
- **Sensitive Files Access**: Never view or read `.env.local` and `credentials.json`. Always respect user privacy regarding secrets and configurations in that file.
- **No node terminal execution**: Never execute node commands on the terminal. Ask the user to execute them in their own terminal
- **Move Commands**: When the user requests to "move" a file or directory, execute a direct filesystem move command (e.g., `mv` or `git mv`) to change its location. Do not recreate the file contents manually in a new file as a shortcut. During refactoring, always prefer move over delete and create.
- **Discussion and Planning**: Always respect requests for discussion. Do not begin executing code changes when the user explicitly asks to discuss an issue or design first. Furthermore, if you encounter ambiguity or feel discussion is needed during execution, stop and discuss it rather than guessing or proceeding blindly.

