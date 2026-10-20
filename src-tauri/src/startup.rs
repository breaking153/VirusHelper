use std::ffi::OsString;

pub struct StartupPaths(pub Vec<String>);

pub fn paths_from_args(args: impl IntoIterator<Item = OsString>) -> Vec<String> {
    let mut args = args.into_iter().peekable();
    if args.peek().is_some_and(|arg| arg == "--") {
        args.next();
    }
    args.filter(|arg| !arg.is_empty())
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn get_startup_paths(paths: tauri::State<'_, StartupPaths>) -> Vec<String> {
    // Read-only: React StrictMode may issue this request more than once.
    paths.0.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_shell_paths_with_spaces_unicode_and_optional_separator() {
        let args = ["--", "C:\\测试 文件\\abc.txt", "C:\\folder"].map(OsString::from);
        assert_eq!(
            paths_from_args(args),
            vec!["C:\\测试 文件\\abc.txt", "C:\\folder"]
        );
    }

    #[test]
    fn empty_launch_has_no_paths_and_other_arguments_are_not_executed() {
        assert!(paths_from_args(Vec::<OsString>::new()).is_empty());
        assert_eq!(paths_from_args([OsString::from("--help")]), vec!["--help"]);
    }
}
